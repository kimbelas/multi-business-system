import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  type Capability,
  ROLES,
  type Role,
  SPEC_LABEL,
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
