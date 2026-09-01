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

/**
 * The name out of an embedded `profiles`, however the client decided to type it.
 *
 * PostgREST returns a to-one embed as an object; the untyped client infers an array, so a direct
 * cast is a type error and an unchecked one would be a lie. `lib/roster.ts` normalises the same
 * way at runtime, and this test asserting through the same shape is the point - if that assumption
 * is ever wrong, both fail together rather than the test passing while the screen renders nothing.
 */
function embeddedName(profiles: unknown): string | undefined {
  const one = Array.isArray(profiles) ? profiles[0] : profiles;
  return (one as { full_name?: string } | null | undefined)?.full_name;
}

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

    it("refuses an owner grant pinned to a single branch", async () => {
      /*
       * Card 0019's last criterion, and until now a claim rather than a test: `actions.ts` said
       * "the persona suite asserts it" and the suite asserted the composite foreign key in both
       * orderings and the org-wide owner being accepted - never this.
       *
       * `owner_is_org_wide` is what refuses it. An owner scoped to one branch is a grant that
       * means nothing: every policy that consults `owned_org_ids()` ignores `branch_id`, so such a
       * row would read as full org access while looking like a branch-level one on screen.
       *
       * Asserted against the service role, because the constraint has to hold for the invite path,
       * which is the one writer no policy watches.
       */
      const { error } = await f.admin.from("memberships").insert({
        user_id: f.personas.outsider.userId,
        org_id: f.orgId,
        branch_id: f.branchA,
        role: "owner",
      });
      expect(error, "an owner may not be scoped to one branch").not.toBeNull();
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

    it("has no second spelling of ownership to reach for", async () => {
      /*
       * `organizations.owner_id` is gone - card 0033. It was read by no policy and maintained by
       * nothing, and the test that used to live here pinned it as decorative: the fixture named the
       * owner persona on an org they held no grant in, and asserted the org stayed invisible.
       *
       * That documented the trap without disarming it. The replacement asserts the column does not
       * exist, which is the only version of this claim that cannot rot: a policy cannot reach for
       * what is not there, and if somebody re-adds the column this fails and asks why.
       *
       * PostgREST answers an unknown column with 42703 rather than an empty result, so this is a
       * real assertion and not an absence that could also mean "no rows".
       */
      const { error } = await f.admin.from("organizations").select("owner_id").limit(1);
      expect(
        error,
        "organizations.owner_id is back; ownership has two spellings again",
      ).not.toBeNull();
      expect(error?.code ?? error?.message).toBe("42703");
    });

    it("gives a person with grants in two organisations reach into both, and no more", async () => {
      /*
       * The plan's own assumption - "one person can hold different roles at different branches" -
       * with the branches in different tenancies. Card 0035 exists because `Scope.orgId` answered
       * "which org is this person in" with `memberships[0].org_id` from a query with no ORDER BY,
       * so for exactly this person it was whichever row Postgres returned first.
       *
       * The grant is created here and removed at the end rather than added to the fixture, on
       * purpose. Five assertions in this suite name the exact set of people in the first org
       * ("owner, managerA, staffA, staffB"), and a sixth persona would turn each of them into a
       * count nobody had chosen. Its lifetime is this test.
       */
      const bridge = f.personas.staffB;
      const grant = await f.admin
        .from("memberships")
        .insert({
          user_id: bridge.userId,
          org_id: f.otherOrgId,
          branch_id: f.otherBranchId,
          role: "staff",
        })
        .select("id")
        .single();
      expect(grant.error?.message ?? null).toBeNull();

      try {
        /*
         * Both tenancies, through RLS, on a session that was signed in BEFORE the grant existed -
         * which is also the proof that reach is decided per request rather than baked into a token.
         */
        const orgs = await bridge.db.from("organizations").select("id");
        const ids = orgs.data?.map((row) => row.id) ?? [];
        expect(ids).toContain(f.orgId);
        expect(ids).toContain(f.otherOrgId);
        expect(ids.length, "exactly the two they hold a grant in").toBe(2);

        // The role is per branch, not the highest anywhere: staff in the second org, and whatever
        // they already were in the first. Two grants, two answers, no bleed between tenancies.
        const here = await bridge.db.rpc("role_for_branch", { target_branch: f.otherBranchId });
        expect(here.data).toBe("staff");

        // And still not an owner anywhere - a second grant widens reach, never rank.
        const owned = await bridge.db.rpc("owned_org_ids");
        expect(owned.data ?? []).toEqual([]);
      } finally {
        // In a finally, so a failed assertion above does not leave the fixture holding a grant that
        // every later test in this file would silently inherit.
        await f.admin.from("memberships").delete().eq("id", grant.data!.id);
      }
    });

    it("reports no role at a branch in another org", async () => {
      const { data } = await f.personas.owner.db.rpc("role_for_branch", {
        target_branch: f.otherBranchId,
      });
      expect(data).toBeNull();
    });
  });

  // ---------------------------------------------------------------- the staff roster

  /*
   * Card 0019's read half, asserted against the real project.
   *
   * `lib/roster.ts` claimed this suite covered it and it did not: the owner case above selects
   * `user_id, role` with no embed, and the only embedded select anywhere in this file was
   * businesses -> branches. That matters more than a stale comment, because the embed is exactly
   * the landmine 20260831181029 defused once already - adding a second foreign key between two
   * tables made PostgREST refuse to choose, `data` came back null, typecheck stayed green, and the
   * owner's landing screen broke. That migration pre-emptively dropped `memberships_branch_id_fkey`
   * with the note "nothing embeds these two today". Something embeds them now.
   */
  describe("the org roster, as the settings screen reads it", () => {
    it("gives the owner every grant in the org, with each person's name", async () => {
      const { data, error } = await f.personas.owner.db
        .from("memberships")
        .select("user_id, role, branch_id, created_at, profiles ( full_name )")
        .eq("org_id", f.orgId)
        .order("created_at", { ascending: false });

      // A second relationship between memberships and profiles would fail here rather than in a
      // browser, which is the whole reason this test exists.
      expect(
        error?.message ?? null,
        "the profiles embed must resolve to one relationship",
      ).toBeNull();
      expect(data?.length, "owner, managerA, staffA, staffB").toBe(4);

      for (const row of data ?? []) {
        expect(
          embeddedName(row.profiles),
          `every grant should resolve a name: ${row.user_id}`,
        ).toBeTruthy();
      }
    });

    it("lets an owner see another owner, who names no branch", async () => {
      /*
       * `visible_profile_ids()` was "yourself plus colleagues at branches you can reach", and
       * `owner_is_org_wide` forces branch_id null on an owner grant - so `null in (...)` never
       * matched and a second owner resolved to no name at all. Nothing forbids two owners.
       */
      const second = await f.admin
        .from("memberships")
        .insert({
          user_id: f.personas.outsider.userId,
          org_id: f.orgId,
          branch_id: null,
          role: "owner",
        })
        .select("id")
        .single();
      expect(second.error?.message ?? null).toBeNull();

      try {
        const { data } = await f.personas.owner.db
          .from("memberships")
          .select("user_id, profiles ( full_name )")
          .eq("org_id", f.orgId)
          .eq("user_id", f.personas.outsider.userId)
          .maybeSingle();

        expect(embeddedName(data?.profiles), "the other owner's name should resolve").toBeTruthy();
      } finally {
        await f.admin.from("memberships").delete().eq("id", second.data!.id);
      }
    });

    it("does not let a manager read the roster", async () => {
      // The route guard refuses them first. This is what makes the refusal not the only thing
      // standing there: `membership_owner_all` is org-wide for an owner and own-rows-only for
      // everybody else, so a manager who reached the query sees exactly themselves.
      const { data } = await f.personas.managerA.db
        .from("memberships")
        .select("user_id")
        .eq("org_id", f.orgId);
      expect(data?.map((r) => r.user_id)).toEqual([f.personas.managerA.userId]);
    });
  });

  // ---------------------------------------------------------------- revoking

  /*
   * Card 0019: "Revoking a membership removes that person's access at the database, verified by a
   * persona test rather than by the navigation disappearing."
   *
   * The navigation disappearing proves only that a component read a smaller list. This asserts the
   * thing underneath: the same signed-in session, reading the same table, before and after.
   *
   * Built on the outsider rather than on an existing persona, so the fixture's four grants are
   * still four when the next test runs - and the outsider is the one persona whose baseline is
   * already "reads nothing", which makes the before-and-after unambiguous.
   */
  describe("a revoked grant", () => {
    it("takes the branch away from a session that is already signed in", async () => {
      const granted = await f.admin
        .from("memberships")
        .insert({
          user_id: f.personas.outsider.userId,
          org_id: f.orgId,
          branch_id: f.branchA,
          role: "staff",
        })
        .select("id")
        .single();
      expect(granted.error?.message ?? null).toBeNull();

      /*
       * The cleanup is in a `finally`, and that is not tidiness.
       *
       * Without it, an assertion failing between the insert and the delete leaves the grant behind
       * for the rest of the run: `signed_in_members` then counts five where it expects four, and
       * `may_reissue_password` still passes but for the signed-in reason rather than the no-grant
       * reason its name claims. One regression would report as two failures, the second pointing
       * at an unrelated helper.
       */
      try {
        // With the grant: the branch is readable by that person.
        const before = await f.personas.outsider.db
          .from("branches")
          .select("id")
          .eq("id", f.branchA);
        expect(
          before.data?.map((row) => row.id),
          "the grant should open branch A",
        ).toEqual([f.branchA]);

        // The owner revokes it, exactly as `revokeGrant` does - through RLS, by row id.
        const removed = await f.personas.owner.db
          .from("memberships")
          .delete({ count: "exact" })
          .eq("id", granted.data!.id);
        expect(removed.error?.message ?? null).toBeNull();
        expect(removed.count, "the owner's delete should affect exactly one row").toBe(1);

        // Same session, no re-login: the branch is gone.
        const after = await f.personas.outsider.db
          .from("branches")
          .select("id")
          .eq("id", f.branchA);
        expect(after.data, "access should be gone at the database, not just from the menu").toEqual(
          [],
        );

        const memberships = await f.personas.outsider.db.from("memberships").select("id");
        expect(memberships.data).toEqual([]);
      } finally {
        await f.admin.from("memberships").delete().eq("id", granted.data!.id);
      }
    });

    it("cannot be done by a manager", async () => {
      /*
       * The other half: `membership_owner_all` is what permits the delete, so somebody without it
       * removes nothing. A zero-row delete is not an error in PostgREST, which is exactly why
       * `revokeGrant` checks the count rather than trusting the absence of one.
       *
       * Branch A, not branch B. B is invisible to managerA, so a delete there would prove only
       * that you cannot remove what you cannot see. A is their own branch: the row is readable and
       * the delete still has to match nothing, which is the property `membership_owner_all`
       * provides and a future `for all` policy over a manager's own branch would quietly remove.
       */
      const target = await f.admin
        .from("memberships")
        .insert({
          user_id: f.personas.outsider.userId,
          org_id: f.orgId,
          branch_id: f.branchA,
          role: "staff",
        })
        .select("id")
        .single();
      expect(target.error?.message ?? null).toBeNull();

      try {
        const attempt = await f.personas.managerA.db
          .from("memberships")
          .delete({ count: "exact" })
          .eq("id", target.data!.id);
        /*
         * The error is asserted separately from the count. A 403 and a missing content-range
         * header both leave `count` null, so a bare "expected null to be 0" would send the next
         * reader to the wrong layer entirely.
         */
        expect(attempt.error?.message ?? null, "the delete should be refused silently").toBeNull();
        expect(attempt.count, "a manager should remove nothing").toBe(0);

        const survives = await f.admin
          .from("memberships")
          .select("id")
          .eq("id", target.data!.id)
          .maybeSingle();
        expect(survives.data, "the grant should still be there").not.toBeNull();
      } finally {
        await f.admin.from("memberships").delete().eq("id", target.data!.id);
      }
    });
  });

  // ---------------------------------------------------------------- creating

  /*
   * `createBusiness` and `createBranch` claim that `biz_owner_all` and `branch_owner_all` "already
   * permit exactly these inserts for an owner". The branch half was asserted by the owner's
   * create-and-delete test above; the business half was asserted by nothing, because every
   * business in the fixture is made with the service role, which bypasses RLS entirely.
   *
   * There was no negative case either, on an action that compiles to a POST endpoint any signed-in
   * person can reach.
   */
  describe("creating a business", () => {
    it("is allowed for the owner, through RLS", async () => {
      const created = await f.personas.owner.db
        .from("businesses")
        .insert({ org_id: f.orgId, type: "spa", name: `rls owner biz ${f.runId}` })
        .select("id")
        .single();
      expect(created.error?.message ?? null).toBeNull();
      await f.admin.from("businesses").delete().eq("id", created.data!.id);
    });

    it("is refused for a manager and for staff", async () => {
      for (const who of ["managerA", "staffA"] as const) {
        const attempt = await f.personas[who].db
          .from("businesses")
          .insert({ org_id: f.orgId, type: "spa", name: `sneak ${who} ${f.runId}` })
          .select("id");
        expect(attempt.error, `${who} should not create a business`).not.toBeNull();
      }
    });

    it("is refused in an organisation the owner does not own", async () => {
      const attempt = await f.personas.owner.db
        .from("businesses")
        .insert({ org_id: f.otherOrgId, type: "spa", name: `cross ${f.runId}` })
        .select("id");
      expect(attempt.error, "a business may not be added to somebody else's org").not.toBeNull();
    });
  });

  // ---------------------------------------------------------------- the two admin helpers

  /*
   * `signed_in_members` and `may_reissue_password` both read `auth.users` as definer functions, so
   * each carries its whole authorization in one `where` clause. Their migrations state what those
   * clauses prevent - "answering for any organisation to anyone who could call it" - and until now
   * nothing checked it. Delete either line in a future `create or replace` and every other test in
   * this repository still passes.
   */
  describe("signed_in_members", () => {
    it("answers for an org you own", async () => {
      const { data, error } = await f.personas.owner.db.rpc("signed_in_members", {
        target_org: f.orgId,
      });
      expect(error?.message ?? null).toBeNull();
      // The personas all signed in during setup, so this is everybody holding a grant.
      expect((data as string[]).length).toBe(4);
    });

    it("tells a manager nothing about their own org", async () => {
      // The gate is `owned_org_ids()`, not membership: a manager holds a grant here and still gets
      // nothing, because the question is about the caller rather than about the org.
      const { data, error } = await f.personas.managerA.db.rpc("signed_in_members", {
        target_org: f.orgId,
      });
      expect(error?.message ?? null).toBeNull();
      expect(data).toEqual([]);
    });

    it("tells an owner nothing about an organisation they do not own", async () => {
      const { data } = await f.personas.owner.db.rpc("signed_in_members", {
        target_org: f.otherOrgId,
      });
      expect(data).toEqual([]);
    });
  });

  describe("may_reissue_password", () => {
    it("refuses somebody who has signed in", async () => {
      // The narrow permission this exists for is a stranded invitation. A working account is not
      // rescued by a new password, it is taken over.
      const { data, error } = await f.personas.owner.db.rpc("may_reissue_password", {
        target: f.personas.staffA.userId,
      });
      expect(error?.message ?? null).toBeNull();
      expect(data).toBe(false);
    });

    it("refuses an owner", async () => {
      const { data } = await f.personas.owner.db.rpc("may_reissue_password", {
        target: f.personas.owner.userId,
      });
      expect(data).toBe(false);
    });

    it("refuses somebody with no grant at all", async () => {
      const { data } = await f.personas.owner.db.rpc("may_reissue_password", {
        target: f.personas.outsider.userId,
      });
      expect(data).toBe(false);
    });

    it("refuses a manager asking about their own colleague", async () => {
      // Same shape as above: the function is scoped to organisations the CALLER owns.
      const { data } = await f.personas.managerA.db.rpc("may_reissue_password", {
        target: f.personas.staffA.userId,
      });
      expect(data).toBe(false);
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
