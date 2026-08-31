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
