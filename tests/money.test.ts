import { describe, expect, it } from "vitest";

import { pesos } from "@/lib/money";

/**
 * The first unit test, and it guards the rule most likely to be broken quietly.
 *
 * Money is numeric(12,2) in the database and must never become a float in the app - section
 * 4 of the spec. 0.1 + 0.2 is the canonical demonstration of why: a cash drawer that is three
 * centavos out because of binary fractions is a variance nobody can explain.
 */
describe("pesos", () => {
  it("adds without floating-point drift", () => {
    expect(pesos("0.10").plus(pesos("0.20")).toString()).toBe("0.30");
  });

  it("keeps two decimal places", () => {
    expect(pesos("1200").toString()).toBe("1200.00");
  });

  it("refuses a value it cannot represent exactly", () => {
    expect(() => pesos("1.005")).toThrow();
  });
});
