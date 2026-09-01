/**
 * Section 7's matrix, encoded once.
 *
 * **This hides things; it does not enforce them.** Row level security is the enforcement layer,
 * and every query is re-checked there regardless of what this says. The reason to have it at all
 * is that a screen offering a button the database will refuse is a worse experience than a screen
 * that never offered it - not that it protects anything.
 *
 * The spec's table is the source of truth and it lives in this repository, so
 * `tests/rbac.test.ts` parses it and fails if these two disagree. That is the only way a matrix
 * transcribed by hand stays transcribed correctly.
 */

export const ROLES = ["staff", "manager", "owner"] as const;
export type Role = (typeof ROLES)[number];

/**
 * How far a grant reaches.
 *
 * `self` is rows this person created or is the subject of; `branch` is everything at the branches
 * their membership names; `org` is the whole organisation. The spec writes this as a parenthetical
 * on some cells - "(own branch)", "(all)" - and leaves it implicit on the rest.
 */
export type Reach = "self" | "branch" | "org";

/** `false` is no grant at all. Anything else is a grant, at that reach. */
export type Grant = false | Reach;

export const CAPABILITIES = [
  "clockSelf",
  "recordSale",
  "viewOwnTransactions",
  "advanceLaundryOrders",
  "viewBranchTransactions",
  "voidTransaction",
  "dailyClose",
  "viewOthersAttendance",
  "manageClients",
  "dashboard",
  "manageOrganisation",
  "exportCsv",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * The label each capability carries in the spec's table, so the test can line the two up without
 * matching on wording it might reformat later.
 */
export const SPEC_LABEL: Record<Capability, string> = {
  clockSelf: "Clock in/out (self)",
  recordSale: "Record sale/expense (self-attributed)",
  viewOwnTransactions: "View own transactions (for ticket reprint)",
  advanceLaundryOrders: "Create/advance laundry orders",
  viewBranchTransactions: "View branch transaction list & totals",
  voidTransaction: "Void a transaction (reason required)",
  dailyClose: "Perform daily close",
  viewOthersAttendance: "View attendance (others)",
  manageClients: "Manage clients",
  dashboard: "Dashboard (cross-branch, cross-business)",
  manageOrganisation: "Manage branches, businesses, staff, roles",
  exportCsv: "Export CSV (attendance, transactions)",
};

/**
 * Reach on the cells the spec qualifies is taken from the spec. On the cells it leaves as a bare
 * tick, reach is the narrowest one that makes the capability useful: recording a sale or clocking
 * in is `self` because both are self-attributed by definition, while advancing a laundry order or
 * editing a client is `branch` because the order and the client belong to the branch and not to
 * whoever happens to touch them.
 */
const MATRIX: Record<Capability, Record<Role, Grant>> = {
  clockSelf: { staff: "self", manager: "self", owner: "self" },
  recordSale: { staff: "self", manager: "self", owner: "self" },
  viewOwnTransactions: { staff: "self", manager: "self", owner: "self" },
  advanceLaundryOrders: { staff: "branch", manager: "branch", owner: "org" },
  viewBranchTransactions: { staff: false, manager: "branch", owner: "org" },
  voidTransaction: { staff: false, manager: "branch", owner: "org" },
  dailyClose: { staff: false, manager: "branch", owner: "org" },
  viewOthersAttendance: { staff: false, manager: "branch", owner: "org" },
  manageClients: { staff: "branch", manager: "branch", owner: "org" },
  dashboard: { staff: false, manager: false, owner: "org" },
  manageOrganisation: { staff: false, manager: false, owner: "org" },
  exportCsv: { staff: false, manager: "branch", owner: "org" },
};

export function grant(role: Role, capability: Capability): Grant {
  return MATRIX[capability][role];
}

export function can(role: Role, capability: Capability): boolean {
  return grant(role, capability) !== false;
}

/**
 * The word for a role, for a screen.
 *
 * Same split as `businessLabel`: the enum value is what the database stores and what a policy
 * compares, and it is not what a person reads. `staff` on screen is a variable that escaped.
 */
const ROLE_LABEL: Record<Role, string> = {
  staff: "Staff",
  manager: "Manager",
  owner: "Owner",
};

export function roleLabel(role: Role): string {
  return ROLE_LABEL[role];
}

/* ------------------------------------------------------------------ which role, where
 *
 * This lived in `lib/scope.ts` and could not be tested, because that module opens with
 * `import "server-only"` - correct for a module that reads cookies and a session, and fatal for a
 * rule that is neither. So the rule went unasserted and the shell derived its rail from the highest
 * role held anywhere, which is the bug card 0004 names.
 *
 * It belongs here anyway: this file is where "what a role may do" lives, and "which role applies"
 * is the same question one step earlier.
 */

/** Owner beats manager beats staff, so "the role somebody has" is the highest one they hold. */
const RANK: Record<Role, number> = { staff: 0, manager: 1, owner: 2 };

export function highest(roles: readonly Role[]): Role {
  return roles.reduce<Role>((best, role) => (RANK[role] > RANK[best] ? role : best), "staff");
}

/**
 * One membership row, reduced to the two fields that decide a role.
 *
 * `MembershipGrant` rather than `Grant`, which this file already uses for a *capability* grant -
 * `false | Reach`. Two different things called a grant in one module is how the wrong one gets
 * imported.
 */
export interface MembershipGrant {
  readonly role: Role;
  readonly branch_id: string | null;
}

/**
 * Which organisation the person is currently *in*, deterministically.
 *
 * This replaces `Scope.orgId`, which was `memberships[0]?.org_id` from a query with no `ORDER BY`.
 * Its own docstring admitted what that meant - "one arbitrary org they have any grant in" - and for
 * anybody holding grants in two organisations it was whichever row Postgres happened to return
 * first, which changes with a plan change rather than with anything a user did.
 *
 * Three callers had each been made safe against it separately: `inviteStaff` derives the org from
 * the chosen branch, `createBusiness` selects from `ownedOrgIds`, `loadRoster` checks the caller's
 * own presence in the result. Three fixes, one cause - and the next caller would have started from
 * the trap rather than from the fix.
 *
 * The rules, in order, and the ordering is the substance:
 *
 *  1. **The active business decides.** If a branch is selected, the organisation is the one that
 *     branch's business belongs to. Not "an org with a grant" but "the tenancy this person is
 *     looking at", which is the question every caller was actually asking, and it follows the
 *     switcher rather than the database's row order.
 *  2. **No active business, exactly one organisation: that one.** An owner who has created nothing
 *     yet has no business to derive from, and a single grant leaves nothing to be arbitrary about.
 *  3. **Otherwise null**, which happens for somebody with no grants at all and for somebody with
 *     grants in two organisations and no branch selected. Null is the honest answer: the caller is
 *     asking which of two, and guessing is what this function exists to stop. Screens fall back to
 *     the product name; anything that WRITES uses `ownedOrgIds` and names its own target.
 *
 * Pure and here rather than in `lib/scope.ts` for the same reason `activeRoleFor` is: that module
 * carries `import "server-only"`, so nothing in it can be unit tested, and this is a rule rather
 * than a query.
 */
export function activeOrgIdFor(
  grantedOrgIds: readonly string[],
  activeBusinessOrgId: string | null,
): string | null {
  if (activeBusinessOrgId !== null) return activeBusinessOrgId;

  const distinct = [...new Set(grantedOrgIds)];
  return distinct.length === 1 ? distinct[0] : null;
}

/**
 * The role that applies where the person is currently looking.
 *
 * The two fallbacks differ on purpose, and that is the whole substance of this function:
 *
 *  - **No active branch** - an owner who has not created one yet - means there is no branch context
 *    to narrow to, so the general role is the right answer. Without this an owner would land on a
 *    shell with staff navigation and no way to reach the screen that creates a branch.
 *  - **An active branch with no grant on it** should not be reachable: a non-owner only sees
 *    branches their own grants name, because that is what RLS returned. If it happens anyway, the
 *    answer is the *lowest* privilege and not the highest - falling back to "what you are
 *    elsewhere" is exactly the bug this function was written to remove.
 */
export function activeRoleFor(
  grants: readonly MembershipGrant[],
  activeBranchId: string | null,
): Role {
  // An org-wide owner is an owner at every branch, including ones they also hold a staff row for.
  if (grants.some((g) => g.role === "owner" && g.branch_id === null)) return "owner";

  if (activeBranchId === null) return highest(grants.map((g) => g.role));

  const here = grants.filter((g) => g.branch_id === activeBranchId).map((g) => g.role);
  return here.length > 0 ? highest(here) : "staff";
}

/**
 * The navigation a role can reach, in order.
 *
 * Derived from the matrix rather than listed separately, because a nav array maintained beside a
 * permission table is a nav array that eventually offers a screen the role cannot open.
 */
export const NAV_CAPABILITY = {
  Counter: "recordSale",
  Dashboard: "dashboard",
  Orders: "advanceLaundryOrders",
  Clients: "manageClients",
  Staff: "viewOthersAttendance",
  Reports: "exportCsv",
  Settings: "manageOrganisation",
} as const satisfies Record<string, Capability>;

export type NavItem = keyof typeof NAV_CAPABILITY;

export function navFor(role: Role): NavItem[] {
  return (Object.keys(NAV_CAPABILITY) as NavItem[]).filter((item) =>
    can(role, NAV_CAPABILITY[item]),
  );
}

/**
 * Where a nav item actually goes, for the ones that exist.
 *
 * `navFor` answers "may this role reach it", which was the only question while the rail rendered
 * inert `<span>`s. It is the wrong question on its own: the rail was offering Counter, Orders,
 * Clients, Staff and Reports, none of which are built, so every one of those labels was a door
 * onto nothing — the exact failure the top of this file says the file exists to prevent, arrived
 * from the other direction. Permitted and existing are different, and until now only one was
 * being asked.
 *
 * A screen joins the app by being added here. Deliberately not derived from the filesystem: a
 * route can exist as a stub nobody should be sent to yet, and `(app)/settings` is one today.
 */
const NAV_HREF: Partial<Record<NavItem, string>> = {
  Settings: "/settings",
};

/** The destinations this role can reach AND that have somewhere to go. */
export function destinationsFor(role: Role): { item: NavItem; href: string }[] {
  return navFor(role)
    .filter((item) => NAV_HREF[item] !== undefined)
    .map((item) => ({ item, href: NAV_HREF[item]! }));
}
