/**
 * Does the ticket allocator actually do what card 0020 claims? Run it, don't read it.
 *
 * The claim is narrow and it is the whole reason this is a counter row rather than a sequence:
 * a number allocated inside a transaction that later rolls back is NOT burned. Postgres says
 * plainly that `nextval` cannot give you that - "sequence objects cannot be used to obtain gapless
 * sequences" - so the property has to be demonstrated, not assumed from the shape of the SQL.
 *
 * Four things, each of which would be silently wrong in a different way:
 *
 *   1. The very first call on a branch returns 1. The insert path and the conflict path return
 *      different expressions (`2 - 1` and `(old + 1) - 1`), and getting one of them wrong shows up
 *      only on a branch's first ever order - which is the one nobody tests.
 *   2. Consecutive calls do not repeat.
 *   3. A rolled-back allocation is reused. This is the point of the whole design.
 *   4. Two orders cannot hold the same ticket_seq at one branch, enforced by the database rather
 *      than by the allocator - because the allocator is not the thing standing between a retry and
 *      a duplicate.
 *
 * Writes nothing that survives: everything happens in transactions that are rolled back, and the
 * counter row it touches belongs to a branch created and discarded inside one of them.
 *
 *   DB_URL=postgresql://... node scripts/ticket-counter-check.mjs
 */
import process from "node:process";

import pg from "pg";

const DB_URL = process.env.DB_URL ?? process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  console.error(
    "DB_URL (or SUPABASE_DB_URL) is required. It is the superuser string, not the anon key.",
  );
  process.exit(2);
}

const client = new pg.Client({ connectionString: DB_URL });
const failures = [];
let ran = 0;

function check(name, actual, expected) {
  ran += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${ok ? "  ok  " : "FAIL  "}${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
  if (!ok) failures.push(name);
}

const seq = async (branch, period = "") =>
  Number(
    (await client.query("select public.next_ticket_seq($1, $2) as n", [branch, period])).rows[0].n,
  );

async function main() {
  await client.connect();
  await client.query("begin");

  // A branch of its own, so the counter row under test is not one a real order will ever use.
  const { rows } = await client.query(`
    with o as (
      select id from public.organizations order by created_at limit 1
    ), b as (
      insert into public.businesses (org_id, type, name)
      select o.id, 'laundry', 'ticket-counter-check' from o returning id
    )
    insert into public.branches (business_id, name)
    select b.id, 'ticket-counter-check' from b returning id
  `);
  const branch = rows[0].id;

  check("the first ever call on a branch returns 1", await seq(branch), 1);
  check("the second returns 2", await seq(branch), 2);
  check("a different period_key is a different counter", await seq(branch, "2027"), 1);

  // 3 — the one that matters. Allocate inside a savepoint, roll it back, allocate again.
  await client.query("savepoint doomed");
  check("an allocation that is about to be undone returns 3", await seq(branch), 3);
  await client.query("rollback to savepoint doomed");
  check("and after the rollback, 3 is still available", await seq(branch), 3);

  // 4 — the guarantee lives on the table, not in the allocator.
  await client.query(
    `insert into public.laundry_orders (branch_id, payment_mode, ticket_seq, ticket_no, status)
     values ($1, 'on_claim', 99, 'A-0099', 'received')`,
    [branch],
  );
  let duplicated = false;
  await client.query("savepoint dup");
  try {
    await client.query(
      `insert into public.laundry_orders (branch_id, payment_mode, ticket_seq, ticket_no, status)
       values ($1, 'on_claim', 99, 'A-0099-again', 'received')`,
      [branch],
    );
    duplicated = true;
  } catch {
    await client.query("rollback to savepoint dup");
  }
  check("the database refuses a second order on the same ticket_seq", duplicated, false);

  // And the two constraints the payment-mode decision rests on.
  await client.query("savepoint checks");
  let acceptedUnpaidAtIntake = false;
  try {
    await client.query(
      `insert into public.laundry_orders (branch_id, payment_mode, ticket_seq, ticket_no, status)
       values ($1, 'at_intake', 100, 'A-0100', 'received')`,
      [branch],
    );
    acceptedUnpaidAtIntake = true;
  } catch {
    await client.query("rollback to savepoint checks");
  }
  check("an at_intake order with no transaction is refused", acceptedUnpaidAtIntake, false);

  await client.query("savepoint claimcheck");
  let acceptedUnpaidClaim = false;
  try {
    await client.query(
      `insert into public.laundry_orders (branch_id, payment_mode, ticket_seq, ticket_no, status)
       values ($1, 'on_claim', 101, 'A-0101', 'claimed')`,
      [branch],
    );
    acceptedUnpaidClaim = true;
  } catch {
    await client.query("rollback to savepoint claimcheck");
  }
  check("an order cannot be handed over while unpaid", acceptedUnpaidClaim, false);

  await client.query("rollback");
  await client.end();

  if (failures.length) {
    console.error(`\n${failures.length} failed: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`\nAll ${ran} passed, and nothing was left behind.`);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await client.query("rollback");
    await client.end();
  } catch {
    /* the connection is already gone */
  }
  process.exit(1);
});
