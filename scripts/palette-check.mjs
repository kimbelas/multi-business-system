/**
 * Print the palette's numbers: gamut, contrast against both grounds, and how far apart the
 * series stay for a viewer with each of the three dichromacies.
 *
 *   node --experimental-strip-types scripts/palette-check.mjs
 *   node --experimental-strip-types scripts/palette-check.mjs --candidates
 *
 * The floors are asserted in `tests/design-tokens.test.ts`; this is for looking at a change
 * before committing to it. Both read the same maths from `tests/support/color.ts`, so the
 * table here and the gate there cannot disagree.
 */
import fs from "node:fs";
import path from "node:path";

import {
  contrastRatio,
  hexToOklch,
  deltaOk,
  isOutOfGamut,
  oklchToRgb,
  readOklch,
  simulate,
  toHex,
} from "../tests/support/color.ts";

const DEFICIENCIES = ["protanopia", "deuteranopia", "tritanopia"];
const LIGHT_GROUND = { l: 0.985, c: 0, h: 0 };
const DARK_GROUND = { l: 0.145, c: 0, h: 0 };

function report(name, entries, ground) {
  const groundRgb = oklchToRgb(ground);
  console.log(`\n${name}`);
  console.log("  " + "-".repeat(72));
  for (const [label, colour] of entries) {
    const rgb = oklchToRgb(colour);
    const contrast = contrastRatio(rgb, groundRgb);
    const flag = isOutOfGamut(colour) ? "  OUT OF GAMUT" : "";
    console.log(
      `  ${label.padEnd(14)} ${toHex(rgb)}  ` +
        `L ${colour.l.toFixed(3)}  C ${colour.c.toFixed(3)}  H ${String(colour.h).padStart(5)}  ` +
        `contrast ${contrast.toFixed(2)}:1${flag}`,
    );
  }

  console.log("  separation (OKLab dE, higher is more distinguishable)");
  const rows = [["normal", null], ...DEFICIENCIES.map((d) => [d, d])];
  for (const [label, deficiency] of rows) {
    const parts = [];
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = oklchToRgb(entries[i][1]);
        const b = oklchToRgb(entries[j][1]);
        const pair = deficiency
          ? deltaOk(simulate(a, deficiency), simulate(b, deficiency))
          : deltaOk(a, b);
        parts.push(`${entries[i][0].slice(0, 4)}/${entries[j][0].slice(0, 4)} ${pair.toFixed(3)}`);
      }
    }
    console.log(`    ${label.padEnd(13)} ${parts.join("   ")}`);
  }
}

if (process.argv.includes("--candidates")) {
  // Okabe & Ito (2008), the standard qualitative palette designed for colour vision
  // deficiency. Trios are named by which of its eight colours they use.
  const OI = {
    blue: "#0072B2",
    orange: "#E69F00",
    green: "#009E73",
    yellow: "#F0E442",
    vermillion: "#D55E00",
    purple: "#CC79A7",
    sky: "#56B4E9",
  };
  const trio = (a, b, c) => [
    ["laundry", hexToOklch(OI[a])],
    ["spa", hexToOklch(OI[b])],
    ["skincare", hexToOklch(OI[c])],
  ];

  const CANDIDATES = {
    // The proposal. Okabe-Ito blue / green / vermillion, plus the accent and the reserved
    // fourth, so the accent is checked against the series rather than beside them.
    "PROPOSED light": [
      ["laundry", hexToOklch(OI.blue)],
      ["spa", hexToOklch(OI.green)],
      ["skincare", hexToOklch(OI.vermillion)],
      ["fourth", hexToOklch(OI.purple)],
      ["accent", { l: 0.58, c: 0.105, h: 202 }],
    ],
    "ACCENT chroma, light": [
      ["c-0.105", { l: 0.58, c: 0.105, h: 202 }],
      ["c-0.095", { l: 0.58, c: 0.095, h: 202 }],
      ["c-0.085", { l: 0.58, c: 0.085, h: 202 }],
      ["spa", hexToOklch(OI.green)],
    ],
    "PROPOSED dark v2  (dark)": [
      ["laundry", { l: 0.7, c: 0.12, h: 244 }],
      ["spa", { l: 0.78, c: 0.13, h: 165.5 }],
      ["skincare", { l: 0.74, c: 0.15, h: 47.5 }],
      ["accent", { l: 0.75, c: 0.09, h: 202 }],
      ["none", { l: 0.6, c: 0, h: 0 }],
    ],
    "PROPOSED light, accent left at 184": [
      ["spa", hexToOklch(OI.green)],
      ["accent-184", { l: 0.6, c: 0.118, h: 184.7 }],
    ],
    "PROPOSED dark": [
      ["laundry", { l: 0.68, c: 0.115, h: 244 }],
      ["spa", { l: 0.76, c: 0.12, h: 165.5 }],
      ["skincare", { l: 0.72, c: 0.15, h: 47.5 }],
      ["fourth", { l: 0.74, c: 0.105, h: 346 }],
      ["accent", { l: 0.72, c: 0.1, h: 202 }],
    ],
    "OI  blue / purple / orange": trio("blue", "purple", "orange"),
    "OI  blue / green / orange": trio("blue", "green", "orange"),
    "OI  sky / purple / vermillion": trio("sky", "purple", "vermillion"),
    "OI  blue / vermillion / green": trio("blue", "vermillion", "green"),
    "A  current (tailwind 500/600)": [
      ["laundry", { l: 0.609, c: 0.126, h: 221.7 }],
      ["spa", { l: 0.656, c: 0.241, h: 354.3 }],
      ["skincare", { l: 0.666, c: 0.179, h: 58.3 }],
    ],
    "B  muted, near-matched L": [
      ["laundry", { l: 0.62, c: 0.105, h: 225 }],
      ["spa", { l: 0.64, c: 0.115, h: 350 }],
      ["skincare", { l: 0.7, c: 0.105, h: 62 }],
    ],
    "C  muted, staggered L": [
      ["laundry", { l: 0.56, c: 0.1, h: 230 }],
      ["spa", { l: 0.66, c: 0.115, h: 350 }],
      ["skincare", { l: 0.76, c: 0.105, h: 70 }],
    ],
    "D  desaturated product": [
      ["laundry", { l: 0.6, c: 0.09, h: 235 }],
      ["spa", { l: 0.58, c: 0.1, h: 340 }],
      ["skincare", { l: 0.7, c: 0.09, h: 50 }],
    ],
  };
  for (const [name, entries] of Object.entries(CANDIDATES)) {
    const dark = name.toLowerCase().includes("dark");
    report(
      `${name}  — on the ${dark ? "dark" : "light"} ground`,
      entries,
      dark ? DARK_GROUND : LIGHT_GROUND,
    );
  }
} else {
  const css = fs
    .readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // Everything after the last `.dark {` is the dark theme; before it, the light one.
  const split = css.lastIndexOf(".dark {");
  const NAMES = [
    ["laundry", "--biz-laundry"],
    ["spa", "--biz-spa"],
    ["skincare", "--biz-skincare"],
    ["fourth", "--biz-fourth"],
    ["unattributed", "--biz-none"],
  ];

  for (const [scope, source, ground] of [
    ["light", css.slice(0, split), LIGHT_GROUND],
    ["dark", css.slice(split), DARK_GROUND],
  ]) {
    const entries = NAMES.map(([label, token]) => [label, readOklch(source, token)]).filter(
      ([, colour]) => colour !== null,
    );
    if (entries.length === 0) {
      console.log(`\n${scope}: no --biz-* tokens found`);
      continue;
    }
    report(`${scope} theme`, entries, ground);
  }
}
