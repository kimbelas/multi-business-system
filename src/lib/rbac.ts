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
