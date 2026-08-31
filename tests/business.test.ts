import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BUSINESS, BUSINESS_TYPES, UNATTRIBUTED_COLOR, businessColor, businessLabel } from "@/lib/business";

/**
 * The registry has to agree with the database, and nothing else makes it.
 *
 * `business_type` is a Postgres enum. `BusinessType` is derived from the keys of `BUSINESS`.
 * Those are two lists maintained by hand in two languages, and the failure when they disagree
 * is not a type error - it is `BUSINESS[row.type]` returning `undefined` on a dashboard, which
 * throws on `.label` at render time, in production, for one business type.
 *
 * The spec promises a fourth business is "one extension table and one feature folder, zero core
 * changes". This is what makes the presentation half of that promise checkable: add the enum
 * value and the suite tells you what else is missing.
 */

const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");

function enumValues(name: string): string[] {
  const sql = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => fs.readFileSync(path.join(MIGRATIONS, file), "utf8"))
    .join("\n");

  const match = new RegExp(`create type (?:public\\.)?${name} as enum \\(([^)]*)\\)`, "i").exec(sql);
  if (match === null) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("the registry and the database", () => {
  it("finds the enum it means to compare against", () => {
    // Without this the comparison passes vacuously the day the migration is reformatted, and
    // the guard silently stops guarding - the defect shape this codebase keeps producing.
    expect(enumValues("business_type").length).toBeGreaterThan(0);
  });

  it("covers exactly the business types the enum declares", () => {
    expect([...BUSINESS_TYPES].sort()).toEqual(enumValues("business_type").sort());
  });
});

describe("the registry itself", () => {
  it("gives every type a label that is not just the key", () => {
    for (const type of BUSINESS_TYPES) {
      const label = businessLabel(type);
      expect(label.length).toBeGreaterThan(0);
      // "Skin Care" rather than "skincare". A key rendered raw is the tell that a label was
      // never written, and it reads as a bug to anyone using the app.
      expect(label).not.toBe(type);
    }
  });

  it("gives every type its own colour token", () => {
    const tokens = BUSINESS_TYPES.map((type) => BUSINESS[type].token);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) expect(token.startsWith("--biz-")).toBe(true);
  });

  it("returns a custom property reference rather than a class name", () => {
    // `bg-biz-${type}` is not in the source as a literal, so Tailwind generates no utility and
    // the element renders with no background. Silently. This is why the mapping is a var().
    for (const type of BUSINESS_TYPES) {
      expect(businessColor(type)).toBe(`var(${BUSINESS[type].token})`);
      expect(businessColor(type)).toMatch(/^var\(--biz-[a-z]+\)$/);
    }
    expect(UNATTRIBUTED_COLOR).toBe("var(--biz-none)");
  });

  it("never returns the unattributed grey for a real business", () => {
    // The grey means "the app could not attribute this". A business resolving to it would be
    // indistinguishable from a gap in the data, on a screen about accountability.
    for (const type of BUSINESS_TYPES) {
      expect(businessColor(type)).not.toBe(UNATTRIBUTED_COLOR);
    }
  });
});
