import { describe, expect, it } from "vitest";

import { BUDGET_KIB, HARD_LIMIT_KIB, decide, parseGzipKiB } from "./support/bundle-budget";

/**
 * Card 0015's third criterion: the gate fails, verified rather than assumed.
 *
 * The criterion is written as "adding a deliberately heavy dependency makes the check fail", and
 * this is that assertion with the slow part removed. Installing something enormous, building a
 * Worker and watching CI go red proves the gate once, on one machine, for one dependency, and
 * leaves nothing behind that would notice the day the check stops working. Feeding the same
 * decision function an over-budget number proves it on every run.
 *
 * The case worth having is the last one. The awk this replaced compared an empty string to 3072
 * and passed - so the check that existed to defend the brief's hardest constraint would have gone
 * green forever the day wrangler reworded a line.
 */

/** The shape wrangler actually prints, so the parser is tested against reality rather than a mock. */
const wranglerOutput = (gzip: string) => `
Total Upload: 4523.12 KiB / gzip: ${gzip}
Uploaded bizdesk (5.39 sec)
`;

describe("reading the measurement", () => {
  it("takes the gzipped figure, not the raw one", () => {
    expect(parseGzipKiB(wranglerOutput("1403.63 KiB"))).toBeCloseTo(1403.63);
  });

  it("converts a size reported in mebibytes", () => {
    /*
     * The misparse that would matter most. A bundle that grew past a mebibyte and started being
     * reported as `gzip: 2.5 MiB` would, read as KiB, be the smallest number this gate had ever
     * seen - an over-limit Worker sailing through as 2.5 KiB.
     */
    expect(parseGzipKiB(wranglerOutput("2.5 MiB"))).toBeCloseTo(2560);
  });

  it("returns null when there is no upload line at all", () => {
    expect(parseGzipKiB("✘ [ERROR] Build failed with 1 error")).toBeNull();
  });

  it("returns null when the line exists but carries no readable size", () => {
    // The exact regression: the line is there, `grep` is satisfied, and nothing numeric comes out.
    expect(parseGzipKiB("Total Upload: 4523.12 KiB / gzip: unknown")).toBeNull();
  });
});

describe("the verdict", () => {
  it("passes a bundle inside the budget and says where it stands", () => {
    const verdict = decide(1403.63);
    expect(verdict.ok).toBe(true);
    expect(verdict.level).toBe("ok");
    // Criterion 2: both numbers on every run, so shrinking headroom is visible before it is gone.
    expect(verdict.message).toContain("1403.6 KiB");
    expect(verdict.message).toContain(String(BUDGET_KIB));
    expect(verdict.message).toContain(String(HARD_LIMIT_KIB));
  });

  it("warns while still passing once three quarters of the budget is gone", () => {
    const verdict = decide(BUDGET_KIB * 0.8);
    expect(verdict.ok).toBe(true);
    expect(verdict.level).toBe("warn");
    expect(verdict.message).toMatch(/headroom/i);
  });

  it("fails over the budget while there is still room under Cloudflare's limit", () => {
    /*
     * The criterion's real content. Failing at 3072 would only fail a build that was already going
     * to be refused on deploy; failing here is what makes the check a budget rather than an echo of
     * the platform's own error.
     */
    const between = (BUDGET_KIB + HARD_LIMIT_KIB) / 2;
    const verdict = decide(between);
    expect(verdict.ok).toBe(false);
    expect(verdict.level).toBe("over-budget");
    expect(verdict.message).toMatch(/budget/i);
  });

  it("names Cloudflare when the hard limit is the one that is gone", () => {
    const verdict = decide(HARD_LIMIT_KIB + 1);
    expect(verdict.ok).toBe(false);
    expect(verdict.level).toBe("over-limit");
    expect(verdict.message).toMatch(/refused on deploy/i);
  });

  it("fails an unreadable measurement rather than passing it", () => {
    /*
     * The one this file exists for. `awk -v g="" -v l=3072 'BEGIN { if (g > l) exit 1 }'` exits 0,
     * so the previous gate reported a pass for every run it could not measure.
     */
    const verdict = decide(null);
    expect(verdict.ok).toBe(false);
    expect(verdict.level).toBe("unmeasured");
    expect(verdict.message).toMatch(/not a small one/i);
  });
});
