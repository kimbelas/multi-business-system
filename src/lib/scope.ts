import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { type BusinessType } from "@/lib/business";
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

export const ACTIVE_BRANCH_COOKIE = "bizdesk_branch";

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
  readonly isOwner: boolean;
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

  // One joined query rather than three round trips. This is also the query that used to recurse
  // (42P17), so it is covered by the persona suite.
  const { data: businessRows } = await supabase
    .from("businesses")
    .select("id, org_id, name, type, branches (id, name, is_active)")
    .order("name");

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
  const { data: org } = activeOrgId
    ? await supabase.from("organizations").select("name").eq("id", activeOrgId).maybeSingle()
    : { data: null };

  return {
    userId: user.id,
    email: user.email ?? "",
    displayName: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "",
    activeOrgId,
    activeOrgName: org?.name ?? null,
    ownedOrgIds: memberships
      .filter((m) => m.role === "owner" && m.branch_id === null)
      .map((m) => m.org_id),
    isOwner,
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
