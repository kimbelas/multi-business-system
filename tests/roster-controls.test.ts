import { describe, expect, it } from "vitest";

import { type RosterRow, controlsFor } from "@/lib/roster-controls";

/**
 * Which controls a roster row offers. Card 0034.
 *
 * The rule this file exists for: **a role is a property of a row, the controls are a property of a
 * person.** The screen used to gate on `member.role !== "owner"`, which was right while nothing could
 * grant or remove an owner — and the obvious replacement, a ternary on the role, is wrong. Somebody
 * promoted to owner keeps their branch row, that row still says "manager", and a per-row rule would
 * go on offering "New password" where `may_reissue_password` refuses anybody who is an owner
 * *anywhere*. `lib/rbac.ts` opens by saying a screen should not offer a button the database refuses.
 *
 * Unit tests rather than a browser, because the rule needs a whole roster to answer and there are
 * more shapes of roster than an e2e run should create real accounts for.
 */

const OWNER = "owner-user";
const OTHER_OWNER = "other-owner-user";
const MANAGER = "manager-user";
const STAFF = "staff-user";

const row = (over: Partial<RosterRow> & Pick<RosterRow, "id" | "userId" | "role">): RosterRow => ({
  signedIn: true,
  ...over,
});

describe("controlsFor", () => {
  describe("a single-owner organisation", () => {
    const roster = [
      row({ id: "m1", userId: OWNER, role: "owner" }),
      row({ id: "m2", userId: STAFF, role: "staff", signedIn: false }),
    ];

    it("offers nothing on the only owner's row", () => {
      // Removing them orphans the organisation, and `owned_org_ids()` is the root of every policy
      // behind this screen - so there is no way back through the app. The database refuses it; this
      // keeps the refusal from being the normal experience.
      const controls = controlsFor(roster, roster[0], OWNER);
      expect(controls.canRemove).toBe(false);
      expect(controls.canGrantOwner).toBe(false);
      expect(controls.canReissuePassword).toBe(false);
    });

    it("offers all three on a staff row who has never signed in", () => {
      const controls = controlsFor(roster, roster[1], OWNER);
      expect(controls.canRemove).toBe(true);
      expect(controls.canGrantOwner).toBe(true);
      expect(controls.canReissuePassword).toBe(true);
    });
  });

  describe("two owners", () => {
    const roster = [
      row({ id: "m1", userId: OWNER, role: "owner" }),
      row({ id: "m2", userId: OTHER_OWNER, role: "owner" }),
    ];

    it("lets one owner remove the other", () => {
      expect(controlsFor(roster, roster[1], OWNER).canRemove).toBe(true);
    });

    it("still refuses the viewer's own owner row", () => {
      /*
       * A separate rule from the count, with a separate reason. Removing your own owner grant costs
       * you `owned_org_ids()` mid-click: the delete succeeds, the page revalidates, and
       * `requireCapability` lands you on a bare 404. A handover is completed BY the new owner, which
       * is what the grant confirmation tells them.
       */
      expect(controlsFor(roster, roster[0], OWNER).canRemove).toBe(false);
    });

    it("offers neither owner a new password or a promotion", () => {
      for (const entry of roster) {
        const controls = controlsFor(roster, entry, OWNER);
        expect(controls.canGrantOwner).toBe(false);
        expect(controls.canReissuePassword).toBe(false);
      }
    });
  });

  describe("somebody holding two grants", () => {
    // Manager at one branch, staff at another. The membership table is one grant per row, and the
    // plan calls a manager covering another branch as staff an ordinary thing.
    const roster = [
      row({ id: "m1", userId: OWNER, role: "owner" }),
      row({ id: "m2", userId: MANAGER, role: "manager", signedIn: false }),
      row({ id: "m3", userId: MANAGER, role: "staff", signedIn: false }),
    ];

    it("offers Make owner once, on their first row", () => {
      // An owner grant is org-wide, so three branches would otherwise mean three buttons doing one
      // thing - and the second click would fail on `memberships_one_org_wide_grant_per_person`.
      expect(controlsFor(roster, roster[1], OWNER).canGrantOwner).toBe(true);
      expect(controlsFor(roster, roster[2], OWNER).canGrantOwner).toBe(false);
    });

    it("says neither row is their last grant here", () => {
      // Which is what lets the remove dialog promise they keep their other access - true here, and
      // false for the single-grant case below.
      expect(controlsFor(roster, roster[1], OWNER).lastGrantHere).toBe(false);
      expect(controlsFor(roster, roster[2], OWNER).lastGrantHere).toBe(false);
    });
  });

  describe("an owner who also holds a branch grant", () => {
    /*
     * The case that makes this a whole-roster question rather than a per-row one, and the reason a
     * ternary on `row.role` would have been wrong. After a promotion this is what the roster looks
     * like: an org-wide owner row AND the branch row they had before.
     */
    const roster = [
      row({ id: "m1", userId: OWNER, role: "owner" }),
      row({ id: "m2", userId: MANAGER, role: "owner" }),
      row({ id: "m3", userId: MANAGER, role: "manager", signedIn: false }),
    ];

    it("offers no new password on their branch row, because they are an owner elsewhere", () => {
      // `may_reissue_password` refuses anybody holding an owner grant anywhere. The row says
      // "manager" and has never signed in, so every per-row signal points the wrong way.
      expect(controlsFor(roster, roster[2], OWNER).canReissuePassword).toBe(false);
    });

    it("offers no second promotion on their branch row", () => {
      expect(controlsFor(roster, roster[2], OWNER).canGrantOwner).toBe(false);
    });

    it("still allows removing that branch row", () => {
      // It is not an owner row, and taking it away leaves their owner grant untouched.
      expect(controlsFor(roster, roster[2], OWNER).canRemove).toBe(true);
    });
  });

  describe("a person who has signed in", () => {
    const roster = [
      row({ id: "m1", userId: OWNER, role: "owner" }),
      row({ id: "m2", userId: STAFF, role: "staff", signedIn: true }),
    ];

    it("is offered no new password", () => {
      /*
       * `may_reissue_password` permits only somebody who has never signed in - a stranded invitation
       * is a rescue, a working account is a takeover. The button used to be offered on every
       * non-owner row, so for anybody who had signed in its only outcome was a refusal.
       */
      expect(controlsFor(roster, roster[1], OWNER).canReissuePassword).toBe(false);
      expect(controlsFor(roster, roster[1], OWNER).canRemove).toBe(true);
    });
  });

  it("never offers the viewer a promotion for themselves", () => {
    // They already hold the grant this button creates; the action refuses it, so it is not offered.
    const roster = [row({ id: "m1", userId: MANAGER, role: "manager" })];
    expect(controlsFor(roster, roster[0], MANAGER).canGrantOwner).toBe(false);
  });
});
