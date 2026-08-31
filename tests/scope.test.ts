import { describe, expect, it } from "vitest";

import { activeRoleFor, navFor, type MembershipGrant } from "@/lib/rbac";

/**
 * Which role applies where the person is standing.
 *
 * Card 0004 asks for this in as many words: "a person holding staff at one branch and manager at
 * another gets each branch's permissions, not the higher of the two everywhere." It was violated -
 * the shell derived its rail from the highest role held anywhere - and it went unnoticed because
 * the rule lived in a closure inside `loadScope`, where asserting it meant standing up a session
 * and a database. It is a pure function now, and this is that assertion.
 *
 * RLS is still the enforcement layer and none of this protects anything. What it protects is the
 * promise in `lib/rbac.ts`: a screen should not offer a button the database will refuse.
 */

const BRANCH_A = "aaaaaaaa-0000-0000-0000-000000000001";
const BRANCH_B = "bbbbbbbb-0000-0000-0000-000000000002";

describe("activeRoleFor", () => {
  it("gives each branch its own role rather than the highest held", () => {
    // The case the card names, and the bug that shipped.
    const grants: MembershipGrant[] = [
      { role: "staff", branch_id: BRANCH_A },
      { role: "manager", branch_id: BRANCH_B },
    ];
    expect(activeRoleFor(grants, BRANCH_A)).toBe("staff");
    expect(activeRoleFor(grants, BRANCH_B)).toBe("manager");
  });

  it("does not offer manager screens at a branch where the person is staff", () => {
    /*
     * The same fact stated as the thing a person would see, because that is what regressed. Asserted
     * through `navFor` rather than on the role string: the role is an implementation detail and the
     * rail is the promise.
     */
    const grants: MembershipGrant[] = [
      { role: "staff", branch_id: BRANCH_A },
      { role: "manager", branch_id: BRANCH_B },
    ];
    const atA = navFor(activeRoleFor(grants, BRANCH_A));
    const atB = navFor(activeRoleFor(grants, BRANCH_B));

    expect(atA).not.toContain("Reports");
    expect(atB).toContain("Reports");
    // Both are branch-scoped roles, so neither reaches the owner-only screens.
    for (const nav of [atA, atB]) {
      expect(nav).not.toContain("Settings");
      expect(nav).not.toContain("Dashboard");
    }
  });

  it("makes an org-wide owner an owner at every branch", () => {
    // Including one they also hold a lesser grant on, which the plan calls an ordinary thing.
    const grants: MembershipGrant[] = [
      { role: "owner", branch_id: null },
      { role: "staff", branch_id: BRANCH_A },
    ];
    expect(activeRoleFor(grants, BRANCH_A)).toBe("owner");
    expect(activeRoleFor(grants, BRANCH_B)).toBe("owner");
    expect(activeRoleFor(grants, null)).toBe("owner");
  });

  it("falls back to the general role when there is no active branch", () => {
    /*
     * An owner who has not created a branch yet. Narrowing to a branch that does not exist would
     * leave them on a shell with staff navigation and no route to the screen that creates one.
     */
    expect(activeRoleFor([{ role: "owner", branch_id: null }], null)).toBe("owner");
    expect(navFor(activeRoleFor([{ role: "owner", branch_id: null }], null))).toContain("Settings");
    expect(activeRoleFor([{ role: "manager", branch_id: BRANCH_A }], null)).toBe("manager");
  });

  it("falls back to the lowest privilege at a branch it has no grant for", () => {
    /*
     * Not reachable through the app - a non-owner only sees branches their own grants name, because
     * that is what RLS returned - but the direction of the fallback is the point. "What you are
     * elsewhere" is the bug; the safe answer to an unexpected branch is the least privilege.
     */
    const grants: MembershipGrant[] = [{ role: "manager", branch_id: BRANCH_B }];
    expect(activeRoleFor(grants, BRANCH_A)).toBe("staff");
  });

  it("takes the higher of two grants on the same branch", () => {
    // `unique (user_id, org_id, branch_id)` makes this unreachable too, but if two rows ever
    // named one branch, the answer is the stronger of them and not whichever sorted first.
    const grants: MembershipGrant[] = [
      { role: "staff", branch_id: BRANCH_A },
      { role: "manager", branch_id: BRANCH_A },
    ];
    expect(activeRoleFor(grants, BRANCH_A)).toBe("manager");
  });

  it("gives a person with no grants at all the lowest privilege", () => {
    // The outsider persona: signs in perfectly, reads nothing. Whatever the shell renders for them
    // must not be an admin rail.
    expect(activeRoleFor([], null)).toBe("staff");
    expect(activeRoleFor([], BRANCH_A)).toBe("staff");
    expect(navFor(activeRoleFor([], null))).not.toContain("Settings");
  });
});
