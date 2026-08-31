import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Fixture, rlsEnv, setUpFixture } from "./harness";

/**
 * Section 5 and the section 7 role matrix, asked of a real project.
 *
 * The rule this suite exists to defend: **RLS is the only authorization layer.** The UI hides
 * what a role cannot do; row level security is what actually stops it. So every assertion here
 * reads through the anon key with a persona's session and asserts on what comes back - never on
 * what a component would have rendered.
 *
 * `pnpm test:rls`, with the three credentials in the environment. Without them the whole file
 * skips rather than passing, because a policy suite reporting green against no database is
 * worse than no policy suite.
 */

const env = rlsEnv();
const describeRls = env ? describe : describe.skip;

describeRls("row level security", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await setUpFixture(env!);
  }, 120_000);

  afterAll(async () => {
    // Runs even when assertions fail, and deletes by recorded id only.
    await f?.teardown();
  }, 120_000);

  // ---------------------------------------------------------------- no session

  describe("anon, with no session at all", () => {
    it("reads nothing from any table", async () => {
      // The check nobody remembers to write. Every table in the schema, because a policy added
      // later to one of them is exactly how this stops being true.
      for (const table of ["profiles", "organizations", "businesses", "branches", "memberships"]) {
        const { data, error } = await f.anon.from(table).select("*").limit(5);
        expect(error, `${table} should not error for anon`).toBeNull();
        expect(data, `anon should read no ${table}`).toEqual([]);
      }
    });

    it("learns nothing from the scope helpers", async () => {
      /*
       * This used to assert that the call was refused, on the reasoning that these functions read
       * across the whole membership table and `anon` holding execute would make the tenancy
       * enumerable without a login.
       *
       * Two things were wrong with that. The revoke did not work - `create function` grants
       * EXECUTE to PUBLIC and revoking from `anon` leaves it - so `anon` could always call them.
       * And there was nothing to enumerate: every one is scoped by `auth.uid()`, which is null
       * without a session, so they return nothing to anybody who is not signed in.
       *
       * Asserting emptiness rather than refusal is the stronger claim, because it is about what
       * leaks rather than about who may knock - and it is the claim that has to hold even if
       * these become reachable some other way.
       */
      const { data, error } = await f.anon.rpc("accessible_branch_ids");
      expect(error?.message ?? null).toBeNull();
      expect(data).toEqual([]);
    });

    it("cannot insert a row anywhere", async () => {
      const { error } = await f.anon
        .from("branches")
        .insert({ business_id: f.businesses.laundry, name: "anon branch" });
      expect(error).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------- signed in, no grant

  describe("outsider, signed in with no membership", () => {
    it("signs in perfectly and reads nothing", async () => {
      // This is correct behaviour and it is why bootstrap-owner.sql exists. An account with no
      // membership is not broken; it is unauthorized, and the app has to say so rather than
      // showing an empty dashboard that looks like no data.
      const { data: user } = await f.personas.outsider.db.auth.getUser();
      expect(user.user?.id).toBe(f.personas.outsider.userId);

      for (const table of ["organizations", "businesses", "branches"]) {
        const { data } = await f.personas.outsider.db.from(table).select("*");
        expect(data, `outsider should read no ${table}`).toEqual([]);
      }
    });

    it("sees only their own profile", async () => {
      const { data } = await f.personas.outsider.db.from("profiles").select("id");
      expect(data?.map((row) => row.id)).toEqual([f.personas.outsider.userId]);
    });

    it("sees only their own memberships, which is none", async () => {
      const { data } = await f.personas.outsider.db.from("memberships").select("*");
      expect(data).toEqual([]);
    });
  });

  // ---------------------------------------------------------------- owner

  describe("owner, org-wide", () => {
    it("reads every business and branch in the org", async () => {
      const { data: businesses } = await f.personas.owner.db
        .from("businesses")
        .select("id")
        .eq("org_id", f.orgId);
      expect(businesses?.length).toBe(3);

      const { data: branches } = await f.personas.owner.db
        .from("branches")
        .select("id")
        .in("id", [f.branchA, f.branchB]);
      expect(branches?.length).toBe(2);
    });

    it("reads businesses joined to branches without recursing", async () => {
      /*
       * The 42P17 regression, as a test.
       *
       * biz_member_read on businesses used to subquery branches while branch_owner_all on
       * branches subqueried businesses. A subquery inside a policy is itself subject to the
       * target table's RLS, so evaluating either evaluated the other, forever. It failed on an
       * empty database exactly as reliably as a full one, and the first thing that hit it was
       * the owner's own landing screen - which runs this query.
       */
      const { data, error } = await f.personas.owner.db
        .from("businesses")
        .select("id, name, type, branches (id, name, is_active)")
        .eq("org_id", f.orgId);
      expect(error?.message ?? null).toBeNull();
      expect(data?.length).toBe(3);
    });

    it("can create and delete a branch", async () => {
      const created = await f.personas.owner.db
        .from("branches")
        .insert({ business_id: f.businesses.spa, name: `owner branch ${f.runId}` })
        .select("id")
        .single();
      expect(created.error?.message ?? null).toBeNull();

      const removed = await f.personas.owner.db
        .from("branches")
        .delete()
        .eq("id", created.data!.id);
      expect(removed.error?.message ?? null).toBeNull();
    });

    it("manages grants across the org", async () => {
      const { data } = await f.personas.owner.db
        .from("memberships")
        .select("user_id, role")
        .eq("org_id", f.orgId);
      // Four grants: owner, managerA, staffA, staffB. The outsider has none.
      expect(data?.length).toBe(4);
    });

    it("is an owner at a branch even without a branch-level row", async () => {
      // role_for_branch has to let owner beat any branch grant, so an owner who also holds a
      // staff membership somewhere is still an owner there.
      const { data, error } = await f.personas.owner.db.rpc("role_for_branch", {
        target_branch: f.branchB,
      });
      expect(error?.message ?? null).toBeNull();
      expect(data).toBe("owner");
    });
  });

  // ---------------------------------------------------------------- branch-scoped roles

  // Both roles are branch-scoped and, for the identity tables, have identical read scope. The
  // role name is not a parameter because nothing below varies by it - when the money tables
  // arrive and manager gains a write a staff member lacks, this splits.
  describe.each(["managerA", "staffA"] as const)("%s, scoped to branch A", (name) => {
    it("sees branch A and not branch B", async () => {
      const { data } = await f.personas[name].db.from("branches").select("id");
      const ids = data?.map((row) => row.id) ?? [];
      expect(ids).toContain(f.branchA);
      expect(ids).not.toContain(f.branchB);
    });

    it("sees the business branch A belongs to", async () => {
      const { data } = await f.personas[name].db.from("businesses").select("id");
      const ids = data?.map((row) => row.id) ?? [];
      expect(ids).toContain(f.businesses.laundry);
    });

    it("does not see the businesses it has no branch in", async () => {
      // The fixture has spa and skincare businesses with no branches this persona can reach.
      const { data } = await f.personas[name].db.from("businesses").select("id");
      const ids = data?.map((row) => row.id) ?? [];
      expect(ids).not.toContain(f.businesses.spa);
      expect(ids).not.toContain(f.businesses.skincare);
    });

    it("cannot create a branch", async () => {
      // No policy grants insert to anyone but the owner, so this fails the with-check rather
      // than being hidden by the UI.
      const created = await f.personas[name].db
        .from("branches")
        .insert({ business_id: f.businesses.laundry, name: `sneak ${f.runId}` })
        .select("id");
      expect(created.error).not.toBeNull();
    });

    it("cannot grant themselves a role", async () => {
      const granted = await f.personas[name].db.from("memberships").insert({
        user_id: f.personas[name].userId,
        org_id: f.orgId,
        branch_id: null,
        role: "owner",
      });
      expect(granted.error).not.toBeNull();
    });

    it("sees only their own membership rows", async () => {
      // A staff member able to list this table would have a staff directory with roles on it.
      const { data } = await f.personas[name].db.from("memberships").select("user_id");
      expect(data?.map((row) => row.user_id)).toEqual([f.personas[name].userId]);
    });
  });

  describe("cross-branch isolation", () => {
    it("keeps staff at B out of branch A", async () => {
      const { data } = await f.personas.staffB.db.from("branches").select("id");
      const ids = data?.map((row) => row.id) ?? [];
      expect(ids).toContain(f.branchB);
      expect(ids).not.toContain(f.branchA);
    });

    it("does not let staff read a branch by naming its id", async () => {
      // The interesting version: not "what does a list return" but "what happens when someone
      // asks for a specific row they should not have". A policy that filters lists but not
      // point reads is a policy that leaks to anyone who guesses an id.
      const { data } = await f.personas.staffB.db.from("branches").select("*").eq("id", f.branchA);
      expect(data).toEqual([]);
    });

    it("keeps colleagues at other branches out of the profile directory", async () => {
      const { data } = await f.personas.staffA.db.from("profiles").select("id");
      const ids = data?.map((row) => row.id) ?? [];
      expect(ids).toContain(f.personas.staffA.userId);
      expect(ids).toContain(f.personas.managerA.userId); // same branch
      expect(ids).not.toContain(f.personas.staffB.userId); // different branch
      expect(ids).not.toContain(f.personas.outsider.userId);
    });

    it("does not let anyone rewrite a profile onto another user", async () => {
      // profiles_update needs `with check` as well as `using`: without it, a row you may update
      // can be rewritten to belong to somebody else.
      const { error } = await f.personas.staffA.db
        .from("profiles")
        .update({ id: f.personas.staffB.userId })
        .eq("id", f.personas.staffA.userId);
      expect(error).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------- cross-tenant isolation

  /*
   * The other axis. Everything above asks "which branch, which role" inside one organisation,
   * and a policy that confused "my org" with "any org" would pass all of it.
   *
   * `memberships` carries an `org_id` and a `branch_id` and, until 20260831172445, nothing tied
   * the two together - so a grant could name one org and a branch belonging to another, and
   * `accessible_branch_ids()` returned that branch because its second arm read `branch_id`
   * without asking whose it was.
   */
  describe("cross-tenant isolation", () => {
    it("refuses a grant naming another org's branch, even with the service role", async () => {
      /*
       * Asserted against the service role on purpose. That key bypasses every policy, so RLS is
       * not what has to hold here - the composite foreign key is. It matters because the staff
       * invite flow in section 9.7 runs with this key, and it is the one writer no policy sees.
       */
      const { error } = await f.admin.from("memberships").insert({
        user_id: f.personas.staffA.userId,
        org_id: f.orgId,
        branch_id: f.otherBranchId,
        role: "manager",
      });
      expect(error, "a branch grant must name that branch's own org").not.toBeNull();
    });

    it("refuses the mirror image of that grant too", async () => {
      // The same mismatch written the other way round: the other org's id against this org's
      // branch. One constraint has to catch both orderings, not whichever was tried first.
      const { error } = await f.admin.from("memberships").insert({
        user_id: f.personas.staffA.userId,
        org_id: f.otherOrgId,
        branch_id: f.branchA,
        role: "manager",
      });
      expect(error).not.toBeNull();
    });

    it("still accepts an org-wide owner grant, whose branch_id is null", async () => {
      /*
       * The constraint that closes the hole must not close the owner case with it. MATCH SIMPLE
       * skips the check when any referenced column is null, which is exactly the shape
       * `owner_is_org_wide` requires - so this is the assertion that tells a working constraint
       * apart from one that has broken every owner in the system.
       */
      const inserted = await f.admin
        .from("memberships")
        .insert({
          user_id: f.personas.outsider.userId,
          org_id: f.otherOrgId,
          branch_id: null,
          role: "owner",
        })
        .select("id")
        .single();
      expect(inserted.error?.message ?? null).toBeNull();
      await f.admin.from("memberships").delete().eq("id", inserted.data!.id);
    });

    it("keeps the owner of one org out of another", async () => {
      const orgs = await f.personas.owner.db.from("organizations").select("id");
      expect(orgs.data?.map((row) => row.id)).not.toContain(f.otherOrgId);

      const branches = await f.personas.owner.db
        .from("branches")
        .select("id")
        .eq("id", f.otherBranchId);
      expect(branches.data).toEqual([]);
    });

    it("does not treat organizations.owner_id as a grant", async () => {
      /*
       * The fixture names the owner persona as `owner_id` on the second org and gives them no
       * membership in it. Authorization reads `memberships.role = 'owner'` and never that column,
       * so the two are separate claims - and a future policy reaching for the convenient one
       * would hand over a whole tenancy. This is the test that notices.
       */
      const { data } = await f.personas.owner.db
        .from("organizations")
        .select("id")
        .eq("id", f.otherOrgId);
      expect(data).toEqual([]);
    });

    it("reports no role at a branch in another org", async () => {
      const { data } = await f.personas.owner.db.rpc("role_for_branch", {
        target_branch: f.otherBranchId,
      });
      expect(data).toBeNull();
    });
  });

  // ---------------------------------------------------------------- function privileges

  /*
   * `create function` grants EXECUTE to PUBLIC, and PUBLIC is a pseudo-role every role carries,
   * so the earlier migrations' `revoke ... from anon` removed nothing. The grants are now
   * explicit: PUBLIC revoked, `authenticated` and `anon` named.
   *
   * `anon` is on that list deliberately. These functions leak nothing without a session - each
   * is scoped by `auth.uid()` - and revoking their execution does not deny an anonymous read, it
   * only changes it from matching no rows to failing to evaluate, which is how five tables
   * started answering 42501 instead of `[]`.
   *
   * Both roles are asserted, because the failure modes are opposite: too narrow and the policies
   * cannot be evaluated by the callers they exist for, too broad and the grant means nothing.
   */
  describe("the scope helpers", () => {
    const NO_ARG_HELPERS = [
      "owned_org_ids",
      "accessible_branch_ids",
      "owned_business_ids",
      "accessible_business_ids",
      "visible_profile_ids",
      "member_org_ids",
    ] as const;

    it("return nothing at all without a session", async () => {
      // The property that matters. Not "anon is refused" but "anon learns nothing", asserted for
      // every helper rather than the one the older test sampled.
      for (const fn of NO_ARG_HELPERS) {
        const { data, error } = await f.anon.rpc(fn);
        expect(error?.message ?? null, `anon should be able to evaluate ${fn}`).toBeNull();
        expect(data, `${fn} should return nothing to anon`).toEqual([]);
      }
      const withArg = await f.anon.rpc("role_for_branch", { target_branch: f.branchA });
      expect(withArg.error?.message ?? null).toBeNull();
      expect(withArg.data, "role_for_branch should name no role to anon").toBeNull();
    });

    it("can be executed by a signed-in user", async () => {
      // Otherwise the revoke above has closed the application instead of the hole: every policy
      // on every table calls at least one of these.
      for (const fn of NO_ARG_HELPERS) {
        const { error } = await f.personas.staffA.db.rpc(fn);
        expect(error?.message ?? null, `staffA should be able to execute ${fn}`).toBeNull();
      }
      const withArg = await f.personas.staffA.db.rpc("role_for_branch", {
        target_branch: f.branchA,
      });
      expect(withArg.error?.message ?? null).toBeNull();
      expect(withArg.data).toBe("staff");
    });
  });

  // ---------------------------------------------------------------- derived branch org

  describe("branches.org_id", () => {
    it("is derived from the business, not supplied by the caller", async () => {
      /*
       * The column is NOT NULL and no caller passes it - a trigger fills it from the business,
       * which is what keeps `insert into branches (business_id, name)` working in the fixture, in
       * the owner's create-a-branch path, and in the branch admin that is not written yet.
       *
       * The value is overwritten rather than defaulted, so naming another org here is not an
       * error to handle but a field that cannot be forged.
       */
      const created = await f.admin
        .from("branches")
        .insert({
          business_id: f.businesses.spa,
          name: `derived ${f.runId}`,
          org_id: f.otherOrgId,
        })
        .select("id, org_id")
        .single();
      expect(created.error?.message ?? null).toBeNull();
      expect(created.data!.org_id).toBe(f.orgId);

      await f.admin.from("branches").delete().eq("id", created.data!.id);
    });
  });
});
