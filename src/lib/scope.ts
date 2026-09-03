import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { type BusinessType } from "@/lib/business";
import { ACTIVE_BRANCH_COOKIE } from "@/lib/cookies";
import { activeOrgIdFor, activeRoleFor, highest, type Role } from "@/lib/rbac";

/**
 * Who is signed in, what they can reach, and which branch they are looking at.
 *
 * Loaded once per request in the `(app)` layout as a server component - section 6, step 3. Three
 * queries, all through the anon key with the user's session, so **what comes back is what RLS
 * allowed**. That is the design: this module cannot show more than the policies permit, because it
 * has no way to ask for more.
 *
 * The active branch lives in a cookie so the server can read it without a round trip, and the
 * cookie is **never trusted**. It is a preference, not a permission: the value is looked up in the
 * branches RLS just returned, and a branch that is not in that list is discarded silently. Someone
 * editing the cookie to another branch's id gets their own scope back, not that branch.
 */

export interface BranchScope {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  /** The role this user holds here. Owner beats any branch-level grant. */
  readonly role: Role;
}

export interface BusinessScope {
  readonly id: string;
  /**
   * The organisation this business belongs to.
   *
   * Carried per business rather than looked up, and this is the field a write should name. It is
   * "the org this branch is actually in" - a fact about the row, true regardless of which tenancy
   * the person is currently viewing.
   */
  readonly orgId: string;
  readonly name: string;
  readonly type: BusinessType;
  readonly branches: readonly BranchScope[];
}

export interface Scope {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  /**
   * The organisation this person is currently in, or null when that has no single answer.
   *
   * Decided by `activeOrgIdFor`, which reads it off the active business rather than off an
   * unordered query - see that function for the three rules and why null is a real answer rather
   * than a missing one. Null means "do not name an organisation here", not "there isn't one".
   */
  readonly activeOrgId: string | null;
  /** The name of `activeOrgId`, or null when there is no single organisation to name. */
  readonly activeOrgName: string | null;
  /**
   * Every organisation this person holds an org-wide owner grant in.
   *
   * Distinct from `activeOrgId`, which is where they are looking, and from `isOwner`,
   * which is a yes/no. A screen offering a branch to write to needs the list: `scope.businesses`
   * spans everything RLS returned, including businesses reachable through a mere branch grant, and
   * offering one of those is offering a choice the database will refuse.
   */
  readonly ownedOrgIds: readonly string[];
  /**
   * The same organisations, with their names, for the one form that has to ask which.
   *
   * Ids alone were enough while every screen either derived the organisation from a row or had only
   * one to choose from. `createBusiness` has neither: there is no branch to derive from, so an owner
   * of two organisations has to be asked - and a select of uuids is not a question anybody can
   * answer.
   *
   * Costs no extra round trip: the query that used to fetch the active organisation's name now
   * fetches these in the same call.
   */
  readonly ownedOrgs: readonly { readonly id: string; readonly name: string }[];
  readonly isOwner: boolean;
  /**
   * Whether this person holds any grant at all.
   *
   * Not derivable from anything else here, which is why it exists. `businesses` being empty has
   * three different causes - no grant anywhere, an owner who has created nothing yet, and somebody
   * whose only branch is closed - and `role` cannot tell them apart because it falls back to
   * "staff" for a person with no grants at all. The empty state used to name one cause for all
   * three and told an owner with no businesses to "ask the owner to add you".
   *
   * True is a fact about grants, not about reach: a staff member at a closed branch holds a grant
   * and reaches nothing. `membership_self_read` is what makes it knowable - it returns your own
   * rows regardless of whether the branch they name is still open.
   */
  readonly hasAnyGrant: boolean;
  /**
   * The highest role held anywhere.
   *
   * **Not what navigation derives from** - see `activeRole`. This is "what is this person, in
   * general", which is the right answer for a profile line and the wrong one for deciding which
   * buttons a screen offers.
   */
  readonly role: Role;
  /**
   * The role at the branch currently selected, which is what navigation derives from.
   *
   * A person can hold manager at one branch and staff at another - the membership table is one
   * grant per row, and the plan calls a manager covering another branch as staff an ordinary
   * thing. `role` above is the highest of those, so deriving navigation from it offered manager
   * screens at a branch where the person is staff. RLS refused the queries behind them, so
   * nothing leaked; what it cost was the thing `lib/rbac.ts` exists to avoid, in its own words:
   * "a screen offering a button the database will refuse is a worse experience than a screen that
   * never offered it".
   */
  readonly activeRole: Role;
  readonly businesses: readonly BusinessScope[];
  readonly activeBranch: BranchScope | null;
  readonly activeBusiness: BusinessScope | null;
  /** True when there is exactly one branch, so no switcher should be shown at all. */
  readonly single: boolean;
}

interface MembershipRow {
  role: Role;
  branch_id: string | null;
  org_id: string;
}

interface BranchRow {
  id: string;
  name: string;
  is_active: boolean;
}

interface BusinessRow {
  id: string;
  org_id: string;
  name: string;
  type: BusinessType;
  branches: BranchRow[];
}

/*
 * `activeRoleFor` and `highest` live in `lib/rbac.ts`, not here.
 *
 * They are pure rules about roles, and this module opens with `import "server-only"` - so a unit
 * test importing them through here fails to load at all. That is not a hypothetical: it is why the
 * rule was never asserted, and why the shell derived its navigation from the highest role held
 * anywhere until card 0004's third criterion was read carefully.
 */

/** Null when nobody is signed in. The layout redirects; this does not, so it stays testable. */
export async function loadScope(): Promise<Scope | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  /*
   * Own rows only, explicitly.
   *
   * `membership_self_read` returns the user's own grants, but `membership_owner_all` returns every
   * grant in an org they own - so without this filter an owner would load the whole staff roster
   * here and `highest()` would be computed over other people's roles. Correct today by accident
   * of owner being the top rank; wrong the moment that is not true.
   */
  const { data: membershipRows } = await supabase
    .from("memberships")
    .select("role, branch_id, org_id")
    .eq("user_id", user.id);

  const memberships = (membershipRows ?? []) as MembershipRow[];
  const isOwner = memberships.some((m) => m.role === "owner" && m.branch_id === null);

  // Hoisted, because the organisation-name query below needs it and so does the returned scope.
  const ownedOrgIds = memberships
    .filter((m) => m.role === "owner" && m.branch_id === null)
    .map((m) => m.org_id);

  // One joined query rather than three round trips. This is also the query that used to recurse
  // (42P17), so it is covered by the persona suite.
  const { data: businessRows } = await supabase
    .from("businesses")
    .select("id, org_id, name, type, branches (id, name, is_active)")
    /*
     * Ordered by name AND then by id, because name alone is not a total order.
     *
     * Card 0035 replaced an arbitrary `memberships[0]` with `activeOrgIdFor`, and the unit tests pin
     * that function as order-independent. A review then pointed out that its INPUT was not fully
     * determined: the active business falls back to the first branch of the first business, and two
     * organisations can each hold a business with the same name. `.order("name")` leaves that tie to
     * the plan, so the tie would decide `activeOrgId` - the same coin flip one level down, and one
     * the reload test could not catch because both loads would agree.
     *
     * `id` is unique, so this is a total order and the fallback is now deterministic for real rather
     * than deterministic given a tie-break nobody specified.
     *
     * ## And the same defect one level further down, found while writing card 0004's reload test
     *
     * The BRANCHES were an embedded resource with no ordering at all, so their order was whatever
     * PostgREST returned. The fallback is "the first branch of the first business", which made the
     * branch an owner lands on - before they have ever switched, which is every owner on their
     * first visit - unspecified rather than merely tie-broken. Two loads could disagree, and the
     * criterion being tested here is that the selection survives a refresh.
     *
     * It also decided the order of the branch list on this page and on the switcher, so a list that
     * reshuffles between visits was the visible half of the same cause.
     *
     * `referencedTable` orders the embed and, per postgrest-js, does not affect the parent's own
     * ordering - so all four clauses are needed and none of them replaces another.
     */
    .order("name")
    .order("id")
    .order("name", { referencedTable: "branches" })
    .order("id", { referencedTable: "branches" });

  // One rule, one implementation. This was a separate closure that happened to agree with
  // `activeRoleFor`; two copies of a permission rule is one copy too many.
  const roleAt = (branchId: string): Role => activeRoleFor(memberships, branchId);

  const businesses: BusinessScope[] = ((businessRows ?? []) as BusinessRow[]).map((business) => ({
    id: business.id,
    orgId: business.org_id,
    name: business.name,
    type: business.type,
    branches: (business.branches ?? []).map((branch) => ({
      id: branch.id,
      name: branch.name,
      isActive: branch.is_active,
      role: roleAt(branch.id),
    })),
  }));

  const allBranches = businesses.flatMap((business) =>
    business.branches.map((branch) => ({ branch, business })),
  );

  /*
   * The cookie is a preference. `find` over what RLS returned is what makes it safe: a value
   * naming a branch this user cannot reach simply does not match, and they fall back to their
   * first branch rather than being shown an error about a branch they should not know exists.
   */
  const requested = (await cookies()).get(ACTIVE_BRANCH_COOKIE)?.value;
  const chosen =
    allBranches.find((entry) => entry.branch.id === requested) ?? allBranches[0] ?? null;

  /*
   * Resolved here rather than earlier, because it depends on the active business and that depends
   * on the cookie. One more round trip only when there is a single organisation to name.
   */
  const activeOrgId = activeOrgIdFor(
    memberships.map((m) => m.org_id),
    chosen?.business.orgId ?? null,
  );
  /*
   * One query for every organisation name this render needs: the active one, to put in the header,
   * and the owned ones, for the create-business form's select.
   *
   * `in` rather than `eq`, which is the same round trip. The active organisation is included
   * explicitly because it is not necessarily owned - a manager's active org is one they merely hold a
   * grant in - so taking names only from `ownedOrgIds` would blank the header for everybody who is
   * not an owner.
   */
  const nameFor = new Map<string, string>();
  const wantedNames = [...new Set([...ownedOrgIds, ...(activeOrgId ? [activeOrgId] : [])])];
  if (wantedNames.length > 0) {
    const { data: orgRows } = await supabase
      .from("organizations")
      .select("id, name")
      .in("id", wantedNames);
    for (const row of (orgRows ?? []) as { id: string; name: string }[]) {
      nameFor.set(row.id, row.name);
    }
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    displayName: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "",
    activeOrgId,
    activeOrgName: (activeOrgId && nameFor.get(activeOrgId)) || null,
    ownedOrgIds,
    /*
     * Named, and only the ones a name came back for. A missing name means RLS did not return that
     * organisation, which should not happen for an org you own - and offering an option labelled
     * "undefined" would be worse than offering one fewer.
     */
    ownedOrgs: ownedOrgIds
      .filter((id) => nameFor.has(id))
      .map((id) => ({ id, name: nameFor.get(id)! })),
    isOwner,
    hasAnyGrant: memberships.length > 0,
    role: isOwner ? "owner" : highest(memberships.map((m) => m.role)),
    activeRole: activeRoleFor(memberships, chosen?.branch.id ?? null),
    businesses,
    activeBranch: chosen?.branch ?? null,
    activeBusiness: chosen?.business ?? null,
    single: allBranches.length === 1,
  };
}

/**
 * Whether this user can reach a branch, asked of RLS rather than of the cookie.
 *
 * `b/[branchId]` routes call it to decide between rendering and a 404. A select returning nothing
 * is indistinguishable from the branch not existing, which is the right answer to give someone
 * probing ids: "no" and "not found" should look the same.
 */
export async function canReachBranch(branchId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("branches").select("id").eq("id", branchId).maybeSingle();
  return data !== null;
}
