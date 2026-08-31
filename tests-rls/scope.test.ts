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

    it("cannot call the scope helpers", async () => {
      // They read across the whole membership table by design, so execute is revoked from anon.
      // Without that, the tenancy is enumerable with no login.
      const { error } = await f.anon.rpc("accessible_branch_ids");
      expect(error).not.toBeNull();
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
});
