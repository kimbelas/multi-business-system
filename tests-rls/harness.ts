import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

/**
 * The five personas, against a real Supabase project.
 *
 * ## Why not a local database
 *
 * Because RLS is the only authorization layer in this app, and a policy suite that passes
 * against a substitute proves the substitute. What has to hold is that *this project*, with
 * these migrations applied and PostgREST in front of it, refuses the reads it should - and the
 * one bug already found here (42P17, an infinite recursion between two policies) was a
 * property of the deployed policies rather than of the schema on paper.
 *
 * ## What that costs, and how it is contained
 *
 * The suite writes to the project it is pointed at. Everything it creates lives under one
 * organization whose name carries a run id, and teardown deletes by the ids it recorded and
 * nothing else - no `delete from` without a filter, no cleanup by name pattern that could
 * catch a real row. Teardown runs even when assertions fail.
 *
 * It still creates and deletes real auth users, so point it at a development project. Nothing
 * here can be undone by a rollback, because PostgREST is not a transaction.
 *
 * ## Credentials
 *
 * Read from the environment, never from a file in the repo. Absent credentials make the suite
 * **skip**, not pass - a test that cannot run and reports green is the defect shape this
 * codebase has already produced four times.
 */

export interface RlsEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

const RLS_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * Null when the suite has nothing to run against. Callers must skip, not pass.
 *
 * **Partial configuration throws instead.** Nobody sets two of these three on purpose, so a
 * partial set is a mistake in the environment rather than a decision to skip - and the cost of
 * reading it as a decision was the whole suite:
 *
 *   the `rls` CI job had NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY configured
 *   and SUPABASE_SERVICE_ROLE_KEY absent. The old `!url || !anonKey || !serviceRoleKey` collapsed
 *   that to the same `null` as a fresh clone, all 36 tests skipped, vitest exited 0, and the job
 *   went green. The step that exists to catch exactly this printed `Target:
 *   <project>.supabase.co` and no warning, because it checks the URL alone.
 *
 * So the authorization suite for an app whose only authorization layer is RLS reported success
 * having asserted nothing, on the one project it was pointed at. Three of these are needed and
 * the difference between "none" and "some" is the difference between a fork with no credentials
 * and a misconfiguration worth failing over.
 */
export function rlsEnv(): RlsEnv | null {
  const missing = RLS_VARS.filter((name) => !process.env[name]);
  if (missing.length === RLS_VARS.length) return null;
  if (missing.length > 0) {
    throw new Error(
      `The RLS suite is partially configured, which is never deliberate. Missing: ` +
        `${missing.join(", ")}. Set all three, or none to skip.`,
    );
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  };
}

export const PERSONAS = ["owner", "managerA", "staffA", "staffB", "outsider"] as const;

export type PersonaName = (typeof PERSONAS)[number];

export interface Persona {
  name: PersonaName;
  userId: string;
  /**
   * The generated password, exposed so a browser can sign in as this persona.
   *
   * Was a local in `setUpFixture`, which was enough while the only consumer created its own
   * Supabase client. The e2e suite signs in through the login form instead - deliberately, because
   * that exercises the real session path rather than minting a token beside it - and a form needs
   * the password.
   *
   * Safe to hold: it is generated per run, belongs to an account this fixture created and will
   * delete, and never leaves the test process.
   */
  password: string;
  email: string;
  /** Signed in, anon key, subject to RLS. This is the client every assertion uses. */
  db: SupabaseClient;
}

export interface Fixture {
  runId: string;
  orgId: string;
  /** Business ids by type, for the three types the enum declares. */
  businesses: Record<string, string>;
  /** Two branches under the laundry business: A and B. */
  branchA: string;
  branchB: string;
  /**
   * A second organisation nobody in `personas` holds a membership in.
   *
   * Every other assertion in the suite is about reach *within* one tenancy - which branch, which
   * role. This is the other axis, and without a second org there is nothing to test it against:
   * a policy that confused "my org" with "any org" would pass every single-tenant assertion.
   *
   * `owner_id` on this org is deliberately set to the owner persona while granting them no
   * membership in it, because `organizations.owner_id` and `memberships.role = 'owner'` are two
   * different claims about ownership and only the second one is wired to RLS. Setting it this way
   * makes that a tested property rather than an unexamined one.
   */
  otherOrgId: string;
  otherBranchId: string;
  personas: Record<PersonaName, Persona>;
  /** No session at all. The check nobody remembers to write. */
  anon: SupabaseClient;
  /**
   * The service-role client, exposed so the suite can assert the things RLS cannot.
   *
   * This key bypasses every policy, so pointing an authorization assertion at it would prove
   * nothing. It is here for the opposite case: a constraint holds against it, and the staff
   * invite flow in section 9.7 will run with exactly this key - so "a grant cannot name another
   * org's branch" has to be true for the one caller no policy is watching.
   */
  admin: SupabaseClient;
  teardown: () => Promise<void>;
}

/**
 * `persistSession: false` on every client here.
 *
 * The default writes the session into a shared store, so signing in the second persona
 * replaces the first and both clients then act as the same user. Every assertion would pass
 * while testing one persona five times, and nothing would look wrong.
 */
function client(env: RlsEnv, key: string): SupabaseClient {
  return createClient(env.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function setUpFixture(env: RlsEnv): Promise<Fixture> {
  const runId = randomUUID().slice(0, 8);
  const admin = client(env, env.serviceRoleKey);
  const anon = client(env, env.anonKey);

  // Recorded as they are created so teardown deletes exactly these and nothing else.
  const createdUsers: string[] = [];
  const createdBranches: string[] = [];
  const createdBusinesses: string[] = [];
  const createdOrgs: string[] = [];

  async function teardown() {
    // Children first: memberships and branches reference businesses, which reference the org.
    // Deleting the auth users last means a failure part-way still leaves no orphan grants.
    for (const id of createdOrgs) {
      await admin.from("memberships").delete().eq("org_id", id);
    }
    for (const id of createdBranches) await admin.from("branches").delete().eq("id", id);
    for (const id of createdBusinesses) await admin.from("businesses").delete().eq("id", id);
    for (const id of createdOrgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  }

  try {
    // ---------------------------------------------------------------- users
    //
    // `email_confirm: true` because public signup is disabled and there is no inbox to click
    // through. This is the same path the owner uses to invite staff, which is the point: if it
    // stops working, so does the only way anyone gets an account.
    const password = `rls-${randomUUID()}`;
    const personas = {} as Record<PersonaName, Persona>;

    for (const name of PERSONAS) {
      const email = `rls-${runId}-${name}@example.com`.toLowerCase();
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw new Error(`could not create ${name}: ${error.message}`);
      const userId = data.user!.id;
      createdUsers.push(userId);

      const db = client(env, env.anonKey);
      const signIn = await db.auth.signInWithPassword({ email, password });
      if (signIn.error) throw new Error(`could not sign in ${name}: ${signIn.error.message}`);

      personas[name] = { name, userId, email, password, db };
    }

    // ---------------------------------------------------------------- tenancy
    //
    // Built with the service role deliberately. Creating the fixture through RLS would mean the
    // setup is also the thing under test, and a policy bug would show up as a broken fixture
    // rather than as a failed assertion.
    const org = await admin
      .from("organizations")
      .insert({ name: `rls-test ${runId}`, owner_id: personas.owner.userId })
      .select("id")
      .single();
    if (org.error) throw new Error(`org: ${org.error.message}`);
    const orgId: string = org.data.id;
    createdOrgs.push(orgId);

    const businesses: Record<string, string> = {};
    for (const type of ["laundry", "spa", "skincare"]) {
      const row = await admin
        .from("businesses")
        .insert({ org_id: orgId, type, name: `rls ${type} ${runId}` })
        .select("id")
        .single();
      if (row.error) throw new Error(`business ${type}: ${row.error.message}`);
      businesses[type] = row.data.id;
      createdBusinesses.push(row.data.id);
    }

    // Two branches under one business, which is what makes cross-branch isolation testable:
    // staff at A and staff at B share an org and a business and must not see each other.
    const branchRows = await admin
      .from("branches")
      .insert([
        { business_id: businesses.laundry, name: `branch A ${runId}` },
        { business_id: businesses.laundry, name: `branch B ${runId}` },
      ])
      .select("id, name")
      .order("name");
    if (branchRows.error) throw new Error(`branches: ${branchRows.error.message}`);
    const [a, b] = branchRows.data;
    createdBranches.push(a.id, b.id);

    // ---------------------------------------------------------------- grants
    //
    // The owner is org-wide with a null branch_id, which `owner_is_org_wide` requires; everyone
    // else names a branch, which `staff_needs_branch` requires. The outsider gets nothing, and
    // that is the persona: an account that signs in perfectly and can read nothing.
    const grants = await admin.from("memberships").insert([
      { user_id: personas.owner.userId, org_id: orgId, branch_id: null, role: "owner" },
      { user_id: personas.managerA.userId, org_id: orgId, branch_id: a.id, role: "manager" },
      { user_id: personas.staffA.userId, org_id: orgId, branch_id: a.id, role: "staff" },
      { user_id: personas.staffB.userId, org_id: orgId, branch_id: b.id, role: "staff" },
    ]);
    if (grants.error) throw new Error(`memberships: ${grants.error.message}`);

    // ---------------------------------------------------------------- a second tenancy
    //
    // One business, one branch, and no membership for anybody. `owner_id` names the owner
    // persona on purpose: it is the claim RLS does *not* read, so an org they are named on and
    // hold no grant in is the cleanest way to assert that the two are separate.
    const otherOrg = await admin
      .from("organizations")
      .insert({ name: `rls-other ${runId}`, owner_id: personas.owner.userId })
      .select("id")
      .single();
    if (otherOrg.error) throw new Error(`other org: ${otherOrg.error.message}`);
    const otherOrgId: string = otherOrg.data.id;
    createdOrgs.push(otherOrgId);

    const otherBiz = await admin
      .from("businesses")
      .insert({ org_id: otherOrgId, type: "laundry", name: `rls other laundry ${runId}` })
      .select("id")
      .single();
    if (otherBiz.error) throw new Error(`other business: ${otherBiz.error.message}`);
    createdBusinesses.push(otherBiz.data.id);

    const otherBranch = await admin
      .from("branches")
      .insert({ business_id: otherBiz.data.id, name: `other branch ${runId}` })
      .select("id")
      .single();
    if (otherBranch.error) throw new Error(`other branch: ${otherBranch.error.message}`);
    createdBranches.push(otherBranch.data.id);

    return {
      runId,
      orgId,
      businesses,
      branchA: a.id,
      branchB: b.id,
      otherOrgId,
      otherBranchId: otherBranch.data.id,
      personas,
      anon,
      admin,
      teardown,
    };
  } catch (error) {
    // A half-built fixture still has rows in it.
    await teardown().catch(() => {});
    throw error;
  }
}
