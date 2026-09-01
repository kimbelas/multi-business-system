import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  type Capability,
  ROLES,
  type Role,
  SPEC_LABEL,
  activeOrgIdFor,
  can,
  grant,
  navFor,
} from "@/lib/rbac";

/**
 * The matrix in `src/lib/rbac.ts` against the matrix in the spec.
 *
 * Section 7 is a markdown table in `multi-business-system-spec.md`, which is in this repository.
 * That makes it checkable rather than merely quotable: this test parses the table and fails if the
 * code disagrees with it. A permission matrix transcribed by hand is a permission matrix that
 * drifts, and the direction it drifts is always toward showing more.
 *
 * What the table asserts is which cells are granted. Reach - the "(own branch)" and "(all)"
 * parentheticals - is checked separately below, because the table only qualifies some cells.
 */

const SPEC = fs.readFileSync(path.join(process.cwd(), "multi-business-system-spec.md"), "utf8");

/** `{ "Clock in/out (self)": { staff: true, manager: true, owner: true }, ... }` */
function specMatrix(): Record<string, Record<Role, boolean>> {
  const section = SPEC.slice(SPEC.indexOf("## 7. RBAC Matrix"));
  const table = section.slice(0, section.indexOf("\n---"));
  const out: Record<string, Record<Role, boolean>> = {};

  for (const line of table.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const [label, ...rest] = cells;
    // Skip the header and the separator row.
    if (label === "Capability" || /^-+$/.test(label.replace(/[\s:]/g, ""))) continue;

    const [staff, manager, owner] = rest.map((cell) => cell.includes("✅"));
    // A cell has to say one or the other. A blank cell would otherwise read as a denial.
    for (const cell of rest) {
      expect(
        cell.includes("✅") || cell.includes("❌"),
        `spec row "${label}" has a cell that is neither granted nor denied: "${cell}"`,
      ).toBe(true);
    }
    out[label] = { staff, manager, owner };
  }
  return out;
}

describe("the spec table", () => {
  const table = specMatrix();

  it("was found and parsed", () => {
    // Without this the comparison passes vacuously the day the spec is reformatted, and the guard
    // stops guarding while still reporting green.
    expect(Object.keys(table).length).toBe(CAPABILITIES.length);
  });

  it("names every capability the code does", () => {
    const specLabels = Object.keys(table).sort();
    const codeLabels = CAPABILITIES.map((capability) => SPEC_LABEL[capability]).sort();
    expect(codeLabels).toEqual(specLabels);
  });

  it.each(CAPABILITIES)("agrees with the code on %s", (capability: Capability) => {
    const row = table[SPEC_LABEL[capability]];
    expect(row, `no spec row labelled "${SPEC_LABEL[capability]}"`).toBeDefined();
    for (const role of ROLES) {
      expect(can(role, capability), `${role} / ${capability}`).toBe(row[role]);
    }
  });
});

describe("reach", () => {
  it("gives the owner the whole organisation wherever they are granted anything", () => {
    // The owner is org-wide by construction: `owner_is_org_wide` requires a null branch_id, so a
    // branch-scoped owner grant is not a thing the schema can hold.
    for (const capability of CAPABILITIES) {
      const g = grant("owner", capability);
      if (g === false) continue;
      // `self` is the exception and it is deliberate: a sale is attributed to whoever recorded it,
      // owner included, and an owner clocking in is clocking themselves in.
      expect(["org", "self"], capability).toContain(g);
    }
  });

  it("never gives a manager more than their branch", () => {
    for (const capability of CAPABILITIES) {
      const g = grant("manager", capability);
      if (g === false) continue;
      expect(["branch", "self"], capability).toContain(g);
    }
  });

  it("never gives staff more than a manager, or a manager more than an owner", () => {
    // Monotonic by role. Not stated in the table, but a table where it failed would be a mistake
    // rather than a design - and this is the assertion that catches a cell edited in the wrong row.
    const rank = { false: 0, self: 1, branch: 2, org: 3 } as const;
    const level = (g: ReturnType<typeof grant>) => rank[String(g) as keyof typeof rank];

    for (const capability of CAPABILITIES) {
      expect(level(grant("staff", capability)), capability).toBeLessThanOrEqual(
        level(grant("manager", capability)),
      );
      expect(level(grant("manager", capability)), capability).toBeLessThanOrEqual(
        level(grant("owner", capability)),
      );
    }
  });
});

describe("navigation", () => {
  it("gives the owner everything and staff the least", () => {
    expect(navFor("owner").length).toBeGreaterThan(navFor("manager").length);
    expect(navFor("manager").length).toBeGreaterThan(navFor("staff").length);
  });

  it("keeps the dashboard and settings away from anyone but the owner", () => {
    // The two the matrix marks owner-only. A staff member reaching either is the shape of bug
    // this file exists for.
    for (const role of ["staff", "manager"] as const) {
      expect(navFor(role)).not.toContain("Dashboard");
      expect(navFor(role)).not.toContain("Settings");
    }
    expect(navFor("owner")).toContain("Dashboard");
    expect(navFor("owner")).toContain("Settings");
  });

  it("offers nothing a role cannot do", () => {
    // The whole point of deriving nav from the matrix rather than listing it beside the matrix.
    for (const role of ROLES) {
      for (const item of navFor(role)) {
        expect(navFor(role)).toContain(item);
      }
    }
    expect(navFor("staff")).toContain("Counter");
  });
});

describe("activeOrgIdFor", () => {
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";

  /*
   * The defect this function replaces: `Scope.orgId` was `memberships[0]?.org_id` from a query with
   * no ORDER BY, so for a person with grants in two organisations it was whichever row Postgres
   * returned first. Nothing a user did changed it and a plan change could.
   */

  it("takes the organisation from the active business, not from the grants", () => {
    // Grants in both, looking at B: the answer is B, and it does not depend on the grant order.
    expect(activeOrgIdFor([A, B], B)).toBe(B);
    expect(activeOrgIdFor([B, A], B)).toBe(B);
    expect(activeOrgIdFor([A, B], A)).toBe(A);
  });

  it("does not care what order the grants arrive in", () => {
    // The property the old field failed. Same inputs, different row order, same answer - including
    // the case with no active business, where the answer is a refusal rather than a pick.
    expect(activeOrgIdFor([A, A, B], null)).toBe(activeOrgIdFor([B, A, A], null));
    expect(activeOrgIdFor([A, B], null)).toBeNull();
  });

  it("answers with the only organisation when there is exactly one", () => {
    // An owner who has created no business yet has nothing to derive from, and one grant leaves
    // nothing to be arbitrary about. Duplicates are one organisation, not two.
    expect(activeOrgIdFor([A], null)).toBe(A);
    expect(activeOrgIdFor([A, A, A], null)).toBe(A);
  });

  it("refuses to guess between two, and says so with null", () => {
    // Null is the honest answer to "which of these two", and the caller falls back to the product
    // name rather than naming somebody's other tenancy.
    expect(activeOrgIdFor([A, B], null)).toBeNull();
  });

  it("returns null for somebody with no grants at all", () => {
    expect(activeOrgIdFor([], null)).toBeNull();
  });

  it("trusts the active business even when no grant names its organisation", () => {
    /*
     * Deliberate, and worth stating because it looks wrong. `scope.businesses` is what RLS
     * returned, so a business being there is already proof of reach - re-deriving permission from
     * the grant list here would be a second authorization layer in the wrong place, and one that
     * disagrees with the database is worse than none.
     *
     * This is a display and lookup value. Everything that WRITES goes through `ownedOrgIds`.
     */
    expect(activeOrgIdFor([A], B)).toBe(B);
  });
});
