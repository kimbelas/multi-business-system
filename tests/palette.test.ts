import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BUSINESS, BUSINESS_TYPES } from "@/lib/business";
import {
  type Deficiency,
  type Oklch,
  contrastRatio,
  deltaOk,
  isOutOfGamut,
  oklchToRgb,
  readOklch,
  simulate,
} from "./support/color";

/**
 * The palette, held to numbers.
 *
 * This exists because the first palette here was chosen for looking good - cyan, pink and
 * amber - and `scripts/palette-check.mjs` then found that under tritanopia the pink and the
 * amber separated by an OKLab distance of 0.009. Two of the three series in the app were, for
 * some readers, the same colour. Nothing on screen said so and no test failed.
 *
 * So the current set is Okabe and Ito's blue, bluish green and vermillion, and these are the
 * floors it was chosen to clear. A change that looks nicer and reads worse fails here.
 */

const SOURCE = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const CSS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "");

/** The theme block declares light in `:root` and dark in the last `.dark`. */
const DARK_AT = CSS.lastIndexOf(".dark {");
const SCOPES = {
  light: { css: CSS.slice(0, DARK_AT), ground: { l: 0.985, c: 0, h: 0 } },
  dark: { css: CSS.slice(DARK_AT), ground: { l: 0.145, c: 0, h: 0 } },
} as const;

const DEFICIENCIES: Deficiency[] = ["protanopia", "deuteranopia", "tritanopia"];

/**
 * WCAG 1.4.11 asks 3:1 for a graphical object needed to understand the content, which a chart
 * segment is. Applied against the ground the segment actually sits on.
 */
const MIN_CONTRAST = 3;

/**
 * The separation floor, in OKLab distance.
 *
 * Not a standard - there isn't one - but calibrated against what was measured: the palette that
 * failed sat at 0.009, and the best trio available reaches 0.090 in its worst case. 0.08 leaves
 * the current set a little room without admitting anything close to the old one.
 */
const MIN_SEPARATION = 0.08;

function tokenFor(type: (typeof BUSINESS_TYPES)[number]): string {
  return BUSINESS[type].token;
}

function seriesIn(scope: keyof typeof SCOPES): [string, Oklch][] {
  return BUSINESS_TYPES.map((type) => {
    const colour = readOklch(SCOPES[scope].css, tokenFor(type));
    expect(colour, `${tokenFor(type)} should be declared in the ${scope} scope`).not.toBeNull();
    return [type, colour!] as [string, Oklch];
  });
}

describe.each(["light", "dark"] as const)("%s theme", (scope) => {
  it("declares a colour for every business, and the unattributed grey", () => {
    // A missing token renders as no background at all, which is the quietest way for a chart
    // to be wrong. So the registry is the list and the stylesheet has to satisfy it.
    for (const type of BUSINESS_TYPES) {
      expect(readOklch(SCOPES[scope].css, tokenFor(type))).not.toBeNull();
    }
    expect(readOklch(SCOPES[scope].css, "--biz-none")).not.toBeNull();
  });

  it("keeps every colour inside sRGB", () => {
    // An out-of-gamut token names a colour no screen renders: the browser clips it, so the
    // value in the file and the value on the wall are different. It cost a rounding of 0.13
    // instead of 0.128 to find this out once already.
    // Annotated, because a mixed array literal widens to (string | Oklch)[][] and loses the
    // tuple - which typechecks as a pair of anything and then fails at the call.
    const all: [string, Oklch][] = [
      ...seriesIn(scope),
      ["none", readOklch(SCOPES[scope].css, "--biz-none")!],
    ];
    const out = all.filter(([, colour]) => isOutOfGamut(colour)).map(([name]) => name);
    expect(out).toEqual([]);
  });

  it("clears 3:1 against its own ground", () => {
    const ground = oklchToRgb(SCOPES[scope].ground);
    for (const [name, colour] of seriesIn(scope)) {
      const ratio = contrastRatio(oklchToRgb(colour), ground);
      expect(ratio, `${name} on the ${scope} ground`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("keeps the accent readable and in gamut", () => {
    const commit = readOklch(SCOPES[scope].css, "--commit");
    expect(commit).not.toBeNull();
    expect(isOutOfGamut(commit!)).toBe(false);
    const ratio = contrastRatio(oklchToRgb(commit!), oklchToRgb(SCOPES[scope].ground));
    expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  describe.each([null, ...DEFICIENCIES])("separation under %s vision", (deficiency) => {
    it(`keeps every pair at least ${MIN_SEPARATION} apart`, () => {
      const series = seriesIn(scope);
      const tooClose: string[] = [];
      for (let i = 0; i < series.length; i += 1) {
        for (let j = i + 1; j < series.length; j += 1) {
          const a = oklchToRgb(series[i][1]);
          const b = oklchToRgb(series[j][1]);
          const distance = deficiency
            ? deltaOk(simulate(a, deficiency), simulate(b, deficiency))
            : deltaOk(a, b);
          if (distance < MIN_SEPARATION) {
            tooClose.push(`${series[i][0]}/${series[j][0]} ${distance.toFixed(3)}`);
          }
        }
      }
      expect(tooClose).toEqual([]);
    });
  });
});

describe("the chart slots alias the domain", () => {
  it("points every slot at a business token, not the other way round", () => {
    // "chart 2" means nothing to anyone reading a dashboard, so the domain tokens hold the
    // values. If this inverts, renaming a business stops being one line.
    for (const type of BUSINESS_TYPES) {
      const slot = BUSINESS[type].chartSlot;
      expect(CSS).toContain(`--chart-${slot}: var(${tokenFor(type)})`);
    }
  });

  it("gives each business its own slot", () => {
    const slots = BUSINESS_TYPES.map((type) => BUSINESS[type].chartSlot);
    expect(new Set(slots).size).toBe(slots.length);
  });
});

describe("the hex comments beside the tokens", () => {
  /*
   * Card 0038. Ten of the seventeen were wrong, and one of them mattered: a contrast figure was
   * expected near 8.3:1 on the strength of `--destructive-strong: /* #991b1b *\/` when the token
   * renders #9f0712 and the real ratio is 7.64:1. Small enough to shrug at, large enough to hide
   * something. The hexes came from a shadcn palette the oklch values were later tuned away from, so
   * the drift was systematic rather than a typo.
   *
   * A test rather than a one-off correction, because a comment nothing checks drifts again. This is
   * the whole reason the card asked for the measurement to be reproducible.
   *
   * Tolerance is one unit per channel, and that number is measured rather than chosen: this
   * converter and Chrome's (via a 1x1 canvas and getImageData) agree exactly on sixteen of the
   * seventeen tokens and differ by one unit of green on the seventeenth. Zero tolerance would make
   * the suite fight a rounding boundary; anything looser would have let #991b1b stand, which was
   * off by twenty units of green.
   */
  const TOLERANCE = 1;

  const commented = SOURCE.split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .map(({ line, number }) => {
      const match = line.match(/^\s*(--[\w-]+):\s*oklch\(([^)]*)\);\s*\/\*\s*(#[0-9a-fA-F]{6})/);
      if (match === null) return null;
      const [l, c, h] = match[2].trim().split(/\s+/).map(Number);
      return { number, name: match[1], oklch: { l, c, h }, claimed: match[3].toLowerCase() };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  it("finds every one of the seventeen hex-commented tokens", () => {
    /*
     * An exact count, not a floor. `>= 15` tolerated two tokens silently dropping out of the scan,
     * which is precisely the failure this test exists to prevent - a regex that stops matching
     * reports green forever.
     *
     * Seventeen is a fact about `globals.css`, so adding or removing an annotated token is meant to
     * fail here and be updated deliberately.
     */
    expect(commented.length).toBe(17);
  });

  it.each(commented)("$name on line $number renders $claimed", ({ oklch, claimed }) => {
    const { r, g, b } = oklchToRgb(oklch);
    const actual = [r, g, b].map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255));
    const expected = [1, 3, 5].map((at) => parseInt(claimed.slice(at, at + 2), 16));

    const hex = (channels: number[]) =>
      "#" + channels.map((v) => v.toString(16).padStart(2, "0")).join("");

    actual.forEach((channel, index) => {
      expect(
        Math.abs(channel - expected[index]),
        `${claimed} is claimed, ${hex(actual)} is rendered`,
      ).toBeLessThanOrEqual(TOLERANCE);
    });
  });
});
