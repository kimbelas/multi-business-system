import type { Role } from "@/lib/rbac";

/**
 * Which controls a roster row may offer. Card 0034.
 *
 * Extracted because the rule stopped being expressible where it lived. `page.tsx` gated the action
 * cluster on `member.role !== "owner"`, which was right while nothing could grant or remove an owner
 * — and the obvious edit, turning it into a ternary, is wrong for a reason worth stating:
 *
 * **A role is a property of a row; the controls are a property of a person.** Once a manager is
 * promoted they hold *two* rows, and their branch row still says "manager". A per-row rule would keep
 * offering "New password" there — and `may_reissue_password` refuses anybody who is an owner
 * *anywhere*, so that button's only possible outcome is a refusal after a confirmation. `lib/rbac.ts`
 * opens by saying a screen should not offer a button the database will refuse.
 *
 * Pure, and here rather than in `lib/roster.ts`, because that module carries `import "server-only"`
 * and nothing inside it can be unit tested. That lesson is already written down twice in this
 * codebase — `activeRoleFor` and `activeOrgIdFor` both moved for it — and this is the third time it
 * decided where a function goes.
 */

/** The shape this needs, structurally, rather than the whole `Member`. Same idea as `MembershipGrant`. */
export interface RosterRow {
  /** The membership row's id, which is what an action acts on. */
  readonly id: string;
  readonly userId: string;
  readonly role: Role;
  readonly signedIn: boolean;
}

export interface RowControls {
  /**
   * Removing this grant.
   *
   * Always offered on a non-owner row. On an owner row, only while another owner remains and only
   * when it is not the viewer's own — see the two comments below, which are different rules.
   */
  readonly canRemove: boolean;
  /**
   * Issuing a new password.
   *
   * Two of the database's three conditions are checked here, and the third cannot be.
   *
   * `may_reissue_password` permits only somebody who has never signed in, holds no owner grant
   * *anywhere*, and holds every one of their grants in an organisation the caller owns. This
   * function sees one organisation's roster, so "an owner anywhere" and "no grant elsewhere" are
   * answered from the tenancy in front of it — which is right for everybody the app has today and
   * wrong for a person who is staff here and holds something in an organisation this owner cannot
   * see. For them the button is offered and the RPC refuses.
   *
   * Not fixable here: the roster genuinely cannot see the other tenancy, and that is RLS working.
   * Closing it means asking the database per row, which is a query per person on a render path. The
   * honest state is that this narrows the button to the two conditions it can check, and the
   * `signedIn` half is a fix in passing — it used to be offered on every non-owner row, including
   * people who signed in months ago.
   */
  readonly canReissuePassword: boolean;
  /**
   * Handing them org-wide owner.
   *
   * Once per person, on their first row, because an owner grant is org-wide and offering "Make owner"
   * beside each of somebody's three branches would be three buttons doing one thing. Never for
   * somebody who is already an owner.
   */
  readonly canGrantOwner: boolean;
  /**
   * Whether this is the person's only grant here.
   *
   * Drives what the remove dialog is allowed to promise. Nothing in this app grants a role to an
   * account that already exists, so removing somebody's last grant is not undoable from this screen —
   * and the dialog used to say it was.
   */
  readonly lastGrantHere: boolean;
}

export function controlsFor(
  roster: readonly RosterRow[],
  row: RosterRow,
  viewerUserId: string,
): RowControls {
  const ownerRows = roster.filter((entry) => entry.role === "owner");
  const owners = new Set(ownerRows.map((entry) => entry.userId));
  const isOwner = owners.has(row.userId);

  const theirRows = roster.filter((entry) => entry.userId === row.userId);
  const firstRowForThisPerson = theirRows[0]?.id === row.id;

  return {
    /*
     * An owner row is removable only while a second owner exists, and never the viewer's own.
     *
     * The count is the invariant: an organisation with no owner cannot be repaired from inside the
     * app at all, because `owned_org_ids()` is the root of every policy behind this screen. The
     * database enforces it — this only decides whether a button appears, so the refusal is not the
     * normal experience.
     *
     * The viewer's own is a separate rule with a separate reason: removing it costs them
     * `owned_org_ids()` mid-click, so the delete succeeds, the page revalidates, and they land on a
     * bare 404. A handover is completed by the new owner instead, which is what the grant
     * confirmation tells them.
     */
    canRemove: row.role !== "owner" || (ownerRows.length > 1 && row.userId !== viewerUserId),
    canReissuePassword: !isOwner && !row.signedIn,
    canGrantOwner: !isOwner && firstRowForThisPerson && row.userId !== viewerUserId,
    lastGrantHere: theirRows.length === 1,
  };
}
