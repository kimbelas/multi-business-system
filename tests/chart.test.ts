import { describe, expect, it } from "vitest";

import { BUSINESS_TYPES, businessColor } from "@/lib/business";
import { type ChartDay, columnPercents, dayTotal, sharePercents } from "@/lib/chart";

const day = (label: string, l: number, s: number, k: number): ChartDay => ({
  label,
  slices: [
    { type: "laundry", value: l },
    { type: "spa", value: s },
    { type: "skincare", value: k },
  ],
});

describe("columnPercents", () => {
  it("makes the busiest day the full height", () => {
    const week = [day("Mon", 100, 0, 0), day("Tue", 300, 100, 0)];
    expect(columnPercents(week)).toEqual([25, 100]);
  });

  it("returns zeroes for a week with no sales instead of dividing by zero", () => {
    // The state of every branch on its first day, and the one that would render NaN% heights.
    expect(columnPercents([day("Mon", 0, 0, 0), day("Tue", 0, 0, 0)])).toEqual([0, 0]);
  });

  it("handles an empty week", () => {
    expect(columnPercents([])).toEqual([]);
  });

  it("sums the slices for the day total", () => {
    expect(dayTotal(day("Wed", 5120, 4300, 3060))).toBe(12480);
  });
});

describe("sharePercents", () => {
  it("sums to exactly 100 on an even three-way split", () => {
    // Rounding each share on its own gives 33/33/33 here - a share bar with a 1% gap in it,
    // and three labels that visibly do not add up.
    const shares = sharePercents([1, 1, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares).toEqual([34, 33, 33]);
  });

  it("sums to exactly 100 on the real numbers", () => {
    const shares = sharePercents([5120, 4300, 3060]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    // 41.03 / 34.46 / 24.52 all floor down to 99, and the leftover point goes to skin
    // care because .52 is the biggest thing flooring threw away.
    expect(shares).toEqual([41, 34, 25]);
  });

  it("gives the leftover to whichever share lost most to flooring", () => {
    // 16.66 / 16.66 / 66.66: all three floor down, and the point goes to the first tie by
    // index so the result is stable rather than depending on sort order.
    expect(sharePercents([1, 1, 4])).toEqual([17, 17, 66]);
  });

  it("sums to 100 across many random splits", () => {
    for (let i = 0; i < 200; i += 1) {
      const values = [0, 1, 2].map(() => Math.floor(Math.random() * 10_000) + 1);
      const shares = sharePercents(values);
      expect(
        shares.reduce((a, b) => a + b, 0),
        values.join("/"),
      ).toBe(100);
    }
  });

  it("draws nothing from nothing", () => {
    expect(sharePercents([0, 0, 0])).toEqual([0, 0, 0]);
    expect(sharePercents([])).toEqual([]);
  });
});

describe("business colour", () => {
  it("gives every type a distinct slot", () => {
    const colors = BUSINESS_TYPES.map(businessColor);
    expect(new Set(colors).size).toBe(BUSINESS_TYPES.length);
  });

  it("resolves through a domain token, not a numbered slot", () => {
    // The values live on `--biz-*` and shadcn's `--chart-N` alias them, not the reverse: a
    // dashboard is read by people, and "chart 2" is not a thing anyone can look up. The token
    // shape and the slot aliasing are asserted in tests/business.test.ts and
    // tests/palette.test.ts; here it is only that the mapping is a custom property at all.
    for (const type of BUSINESS_TYPES) {
      expect(businessColor(type)).toMatch(/^var\(--biz-[a-z]+\)$/);
    }
  });
});
