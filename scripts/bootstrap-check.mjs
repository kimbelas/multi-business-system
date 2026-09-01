/**
 * Does `supabase/bootstrap-owner.sql` do nothing the second time? Card 0041.
 *
 * It used to do a great deal the second time: a whole duplicate organisation, three more businesses,
 * three more branches and a second owner grant, silently. The file said "Run ONCE" and nothing
 * enforced it.
 *
 * ## Why this script exists rather than a documented one-liner
 *
 * The defect was found by accident, by a check that believed it was writing nothing. That file
 * carries its own `begin;` and `commit;`, so wrapping it in a transaction does not contain it - the
 * file's commit ends yours and your rollback becomes a no-op. Anybody being careful walks into that,
 * so the careful path needs to exist in the repository rather than in somebody's memory.
 *
 * ## What it asserts, and why that works on a database that is already set up
 *
 * Not "there is one organisation afterwards" - that would only be true starting from an empty
 * database, and the database anyone has to hand is the one already bootstrapped. It asserts that the
 * SECOND run changes nothing: counts after one run must equal counts after two.
 *
 * That holds either way round. On an empty database the first run creates everything and the second
 * must add nothing, which exercises the create path. On a populated one both runs are no-ops, which
 * exercises the guard. And on the file as it was before this card, the first run added an
 * organisation and the second added another - so the two counts differ and this fails, whichever
 * database you point it at.
 *
 * Nothing is written: the two runs happen inside one transaction that is always rolled back, and the
 * file's own `begin` / `commit` are stripped first so they cannot end it. That stripping is asserted
 * rather than assumed, because getting it wrong is exactly how the original accident happened.
 *
 *   SUPABASE_DB_URL=postgresql://... pnpm bootstrap:check
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";

const FILE = path.join(process.cwd(), "supabase", "bootstrap-owner.sql");

const COUNTS = `
  select
    (select count(*) from public.organizations) as orgs,
    (select count(*) from public.businesses) as businesses,
    (select count(*) from public.branches) as branches,
    (select count(*) from public.memberships where role = 'owner') as owner_grants`;

function stripOuterTransaction(sql) {
  /*
   * Removed by whole statement, not by substring: `commit` appears in prose in this file's own
   * comments, and a substring replace would maul them and leave the real statement standing.
   */
  const withoutBegin = sql.replace(/^\s*begin\s*;\s*$/gim, "");
  const stripped = withoutBegin.replace(/^\s*commit\s*;\s*$/gim, "");

  const begins = (sql.match(/^\s*begin\s*;\s*$/gim) ?? []).length;
  const commits = (sql.match(/^\s*commit\s*;\s*$/gim) ?? []).length;

  /*
   * Fail closed. If the file's shape changes - two transactions, a nested block, a `commit` written
   * differently - this script must refuse rather than run something it does not understand against
   * a real database.
   */
  if (begins !== 1 || commits !== 1) {
    throw new Error(
      `expected exactly one begin; and one commit; in bootstrap-owner.sql, found ${begins} and ` +
        `${commits}. Refusing to run: this script can only contain the file it understands.`,
    );
  }
  if (/^\s*(commit|begin|rollback)\s*;\s*$/gim.test(stripped)) {
    throw new Error("transaction control survived the strip; refusing to run");
  }
  return stripped;
}

const url = process.env.SUPABASE_DB_URL ?? process.env.BOOTSTRAP_CHECK_DB_URL;
if (!url) {
  console.error(
    "SUPABASE_DB_URL is not set.\n\n" +
      "This check needs a database to run against. It writes nothing - both runs happen inside a\n" +
      "transaction that is rolled back - but it does need a real connection, so it is not something\n" +
      "CI does by default.",
  );
  process.exit(1);
}

const sql = stripOuterTransaction(readFileSync(FILE, "utf8"));
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

await client.connect();
await client.query("begin");

let failed = false;
try {
  const before = (await client.query(COUNTS)).rows[0];
  await client.query(sql);
  const afterOne = (await client.query(COUNTS)).rows[0];
  await client.query(sql);
  const afterTwo = (await client.query(COUNTS)).rows[0];

  const show = (label, row) =>
    `${label.padEnd(11)} orgs=${row.orgs} businesses=${row.businesses} branches=${row.branches} owner_grants=${row.owner_grants}`;
  console.log(show("before", before));
  console.log(show("after one", afterOne));
  console.log(show("after two", afterTwo));

  const same = Object.keys(afterOne).every((key) => afterOne[key] === afterTwo[key]);
  if (!same) {
    failed = true;
    console.error(
      "\nFAIL: the second run changed the database. bootstrap-owner.sql is not idempotent.",
    );
  } else {
    const created = before.orgs !== afterOne.orgs;
    console.log(
      `\nPASS: the second run changed nothing.${
        created
          ? " The first run created the organisation, so this exercised the create path."
          : " The organisation already existed, so this exercised the guard rather than creation."
      }`,
    );
  }
} finally {
  // Always. The whole safety argument of this script is this line running.
  await client.query("rollback");
  await client.end();
}

process.exit(failed ? 1 : 0);
