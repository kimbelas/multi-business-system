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

/**
 * Did the file achieve its purpose? Asked separately from "did anything change".
 *
 * A review found that this script passed for a file that can no longer bootstrap ANYTHING. Mistype
 * the email and the `owner` CTE is empty, so `needed` is empty, so both runs insert nothing, so the
 * counts match and it reports PASS - while on a fresh database that file would silently produce no
 * organisation at all. That is card 0041's original failure mode with a certificate attached.
 *
 * So idempotence is not the only thing asserted. After the first run the named account must hold an
 * org-wide owner grant, which is the one row this whole file exists to create: RLS is the only
 * authorization layer, and without it the account signs in and reads nothing.
 */
const OWNER_GRANT = `
  select count(*)::int as grants
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  join auth.users u on u.id = p.id
  where u.email = $1
    and m.role = 'owner'
    and m.branch_id is null`;

/** The email the file names, read from the file rather than repeated here. */
function ownerEmailFrom(sql) {
  const matches = [...sql.matchAll(/email\s*=\s*'([^']+)'/gi)].map((m) => m[1]);
  const unique = [...new Set(matches)];
  if (unique.length !== 1) {
    throw new Error(
      `expected exactly one email address in bootstrap-owner.sql, found ${unique.length}. ` +
        "Refusing to run: this script cannot say whose grant to check for.",
    );
  }
  return unique[0];
}

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
  /*
   * `end` is an accepted synonym for `commit` in Postgres, as are `commit work` and `commit
   * transaction`. A review pointed out that the exact-one check above is satisfied by a file spelled
   * `begin; … commit; … end;` - and the surviving `end;` would commit the caller's transaction,
   * reproducing the accident this script exists to prevent, with the script asserting safety.
   */
  if (/^\s*(commit|begin|rollback|end|abort|start)\b/gim.test(stripped)) {
    throw new Error("transaction control survived the strip; refusing to run");
  }
  return stripped;
}

/**
 * Are we still inside a transaction? Asked of the server, not of a regex.
 *
 * `savepoint` outside a transaction block raises 25P01, so this is a positive check that the file did
 * not commit - which is the thing the text scan above can only guess at. The scan stays because it
 * refuses BEFORE anything runs; this catches whatever the scan did not understand, between the two
 * runs and before the rollback is relied on.
 */
async function assertStillInTransaction(client, when) {
  try {
    await client.query("savepoint bootstrap_check_probe");
    await client.query("release savepoint bootstrap_check_probe");
  } catch (error) {
    throw new Error(
      `the transaction is gone ${when} (${error?.code ?? "unknown"}). The file committed itself, ` +
        "so nothing here can be rolled back. Check it for transaction control this script did not " +
        "recognise, and check the database for what it wrote.",
    );
  }
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

const source = readFileSync(FILE, "utf8");
const sql = stripOuterTransaction(source);
const ownerEmail = ownerEmailFrom(source);

/*
 * TLS, verified when it can be - and said out loud when it cannot.
 *
 * A review flagged that `rejectUnauthorized: false` accepts any certificate on a connection carrying
 * the database password. Correct. The first attempt at the fix simply turned verification on, with a
 * comment asserting that Supabase's pooler presents a publicly trusted certificate. It does not:
 * connecting that way fails with SELF_SIGNED_CERT_IN_CHAIN, because the pooler's chain is rooted in
 * Supabase's own CA rather than a browser-trusted one.
 *
 * So: point `SUPABASE_CA_CERT` at that certificate - the project dashboard offers it as a download -
 * and the connection is verified properly. Without it the connection is still encrypted but the
 * endpoint is unverified, which the run says on its own line rather than leaving in a default.
 *
 * Not defaulted to failing, because a check nobody can run protects nothing, and the alternative
 * for anyone without the cert to hand would be to reach for the env var that turns verification off
 * everywhere.
 */
const caPath = process.env.SUPABASE_CA_CERT;
const ssl = caPath
  ? { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true }
  : { rejectUnauthorized: false };
if (!caPath) {
  console.warn(
    "note: the server certificate is NOT verified. The connection is encrypted, but set\n" +
      "      SUPABASE_CA_CERT to the project's CA certificate to verify the endpoint too.",
  );
}

const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 15_000 });

await client.connect();
await client.query("begin");
/*
 * Bounded, because an open transaction on the target holds row locks on `organizations`,
 * `businesses`, `branches` and `memberships` and blocks VACUUM. If this script stalls or its process
 * is suspended, the server ends the transaction rather than the database waiting on a developer's
 * laptop.
 */
await client.query("set local statement_timeout = '30s'");
await client.query("set local idle_in_transaction_session_timeout = '60s'");

let failed = false;
try {
  const before = (await client.query(COUNTS)).rows[0];

  await client.query(sql);
  await assertStillInTransaction(client, "after the first run");
  const afterOne = (await client.query(COUNTS)).rows[0];

  /*
   * The file did its job, before asking whether it does it twice. Without this, a file that inserts
   * nothing at all - a mistyped email, a renamed table - passes the idempotence check perfectly.
   */
  const { grants } = (await client.query(OWNER_GRANT, [ownerEmail])).rows[0];
  if (grants < 1) {
    failed = true;
    console.error(
      `FAIL: after one run, ${ownerEmail} holds no org-wide owner grant. The file inserted nothing ` +
        "useful, which an idempotence check alone would have called a pass.",
    );
  }

  await client.query(sql);
  await assertStillInTransaction(client, "after the second run");
  const afterTwo = (await client.query(COUNTS)).rows[0];

  const show = (label, row) =>
    `${label.padEnd(11)} orgs=${row.orgs} businesses=${row.businesses} branches=${row.branches} owner_grants=${row.owner_grants}`;
  console.log(show("before", before));
  console.log(show("after one", afterOne));
  console.log(show("after two", afterTwo));

  console.log(`owner grant  ${ownerEmail}: ${grants}`);

  const same = Object.keys(afterOne).every((key) => afterOne[key] === afterTwo[key]);
  if (!same) {
    failed = true;
    console.error(
      "\nFAIL: the second run changed the database. bootstrap-owner.sql is not idempotent.",
    );
  } else if (!failed) {
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
