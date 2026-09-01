import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The design has one accent and no second hue, and this is what makes that true tomorrow.
 *
 * `npx shadcn init` and several `shadcn add` runs rewrite the generated half of
 * `globals.css`. One of the values it writes is a violet `--sidebar-primary`, which was the
 * only chromatic value in an otherwise chroma-0 neutral theme - a default nobody chose, and
 * the exact tell that makes an interface read as generated. It was corrected in place rather
 * than shadowed by a later override, so a regeneration silently brings it back and no diff
 * anyone reads would say so.
 *
 * A comment cannot catch that. This can, so the rule lives here and `docs/01-design.md`
 * explains it.
 */

const SOURCE = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * Comments stripped, because these tests are about declarations and not about prose.
 *
 * Both of the bugs below are explained in comments that necessarily quote the wrong value -
 * "was oklch(... 264.376)", "was --font-sans: var(--font-sans)" - and a scanner that reads
 * those flags the explanation as the offence. The first version of this file dodged that by
 * rewording the comments, which is the tail wagging the dog: the fix is to scan CSS.
 */
const CSS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `oklch(L C H ...)` in the file, with its numbers parsed. */
function oklchValues(): { raw: string; l: number; c: number; h: number }[] {
  const out: { raw: string; l: number; c: number; h: number }[] = [];
  const re = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/g;
  for (let m = re.exec(CSS); m !== null; m = re.exec(CSS)) {
    out.push({ raw: m[0], l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) });
  }
  return out;
}

describe("colour", () => {
  it("finds the oklch values it means to check", () => {
    // Without this the whole file passes vacuously the day the regex stops matching -
    // a guard that guards nothing is the failure mode these tests exist to prevent.
    expect(oklchValues().length).toBeGreaterThan(20);
  });

  /**
   * The band is 255-320, and it was 240-300 for exactly one day.
   *
   * 240-300 was picked as round numbers rather than from where the hues actually sit, and it
   * banned every blue worth having: Okabe and Ito's blue - the one colour in the accessible
   * palette that clears 3:1 on both grounds - is hue 244. The rule exists to keep out the
   * indigo-violet-purple family that makes an interface read as generated, and in OKLCH that
   * family starts at Tailwind indigo-500 (277) and runs through violet-500 (292) to purple-500
   * (304). blue-600, the archetypal one, is 263.
   *
   * So the low edge is 255: it still refuses blue-600 and everything above it, and it admits a
   * clean blue 11 degrees below. The high edge is 320, which lets magenta through and keeps
   * purple out. Narrowing a rule to fit a colour would be cheating; narrowing it because it was
   * measured wrong and was costing the chart its accessibility is the rule working.
   */
  it("has no indigo, violet or purple", () => {
    // Below 0.05 chroma the hue is not perceptible, so a near-grey with an incidental hue
    // reading is not a violation.
    const offenders = oklchValues().filter((v) => v.c > 0.05 && v.h >= 255 && v.h <= 320);
    expect(offenders.map((v) => v.raw)).toEqual([]);
  });

  it("still refuses the blue that started this", () => {
    // A guard whose band was just moved has to be shown to still catch what it was for.
    const banned = { l: 0.546, c: 0.245, h: 262.881 }; // Tailwind blue-600
    expect(banned.c > 0.05 && banned.h >= 255 && banned.h <= 320).toBe(true);
  });

  it("keeps the accent in the teal family", () => {
    // If the accent moves, it moves deliberately - and this test is the thing that has to
    // be edited to let it, which is the point.
    const commit = /--commit:\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(CSS);
    expect(commit).not.toBeNull();
    expect(Number(commit![3])).toBeGreaterThan(160);
    expect(Number(commit![3])).toBeLessThan(210);
    expect(Number(commit![2])).toBeGreaterThan(0.05);
  });

  it("defines every added token in both light and dark", () => {
    const added = [
      "--commit",
      "--commit-foreground",
      "--commit-deep",
      "--good",
      "--warn",
      "--destructive-surface",
      "--destructive-border",
      "--destructive-strong",
    ];
    // `.dark` is the last selector block that carries them, so counting declarations is
    // enough: one in the appended `:root`, one in the appended `.dark`.
    for (const token of added) {
      const declarations = CSS.match(new RegExp(`${token}:\\s*oklch`, "g")) ?? [];
      expect(declarations.length, `${token} should be declared for light and dark`).toBe(2);
    }
  });
});

describe("sizing", () => {
  /**
   * Nothing shrinks on a bigger screen. These are floors, and the values are the ones the
   * design canvas was drawn at - a change here is a change to the design, not a tweak.
   */
  const FLOORS: [string, number][] = [
    ["--key-h", 58],
    ["--pill-h", 46],
    ["--commit-h", 60],
  ];

  for (const [token, floor] of FLOORS) {
    it(`${token} is at least ${floor}px`, () => {
      const m = new RegExp(`${token}:\\s*(\\d+)px`).exec(CSS);
      expect(m, `${token} should be declared in px`).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(floor);
    });
  }

  it("caps the keypad rather than letting it stretch", () => {
    // The one rule the responsive design turns on: extra width buys context, not bigger
    // keys. A cap that grows past ~420px is that rule being abandoned.
    const m = /--pad-max:\s*(\d+)px/.exec(CSS);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(440);
    expect(Number(m![1])).toBeGreaterThanOrEqual(360);
  });

  it("exposes the floors as utilities", () => {
    // `h-key`, `h-pill`, `h-commit`, `max-w-pad`. Without these a floor is a number
    // somebody has to remember, and remembering is what the canvas already failed at once.
    for (const t of ["--spacing-key", "--spacing-pill", "--spacing-commit", "--container-pad"]) {
      expect(CSS).toContain(t);
    }
  });
});

describe("theme wiring", () => {
  /**
   * The font bug was worse than the violet, because it was invisible as a mistake.
   *
   * `--font-sans: var(--font-sans)` refers to itself, so `font-sans` compiled to a
   * `font-family` naming a custom property with no definition anywhere. `html { @apply
   * font-sans }` fell through to the browser default and every heading rendered in Times.
   * Nothing errored, no build failed, and the result looked like somebody had chosen a serif.
   */
  it("has no self-referential variable", () => {
    const offenders = [...CSS.matchAll(/(--[a-z0-9-]+):\s*var\(\s*(--[a-z0-9-]+)\s*\)/g)]
      .filter((match) => match[1] === match[2])
      .map((match) => match[0]);
    expect(offenders).toEqual([]);
  });

  it("declares both elevation steps for light and dark", () => {
    /*
     * Separate from the light/dark loop above, because that one matches `${token}:\s*oklch` and a
     * shadow starts with a length rather than a colour. Adding `--elev-1` to that list would have
     * matched nothing and passed - a guard that cannot fail, which is the defect shape this
     * codebase keeps producing.
     *
     * Both modes are required for a reason that is not tidiness. A shadow is the absence of
     * light, and there is almost none to remove from a near-black ground: the light values land
     * at roughly 1.1:1 against it and do not render at all. Reusing them would leave dark with no
     * card separation whatsoever, and the card is the only thing separating a figure from the
     * page now that the border is gone.
     */
    for (const token of ["--elev-1", "--elev-2"]) {
      const declarations = CSS.match(new RegExp(`${token}:`, "g")) ?? [];
      expect(declarations.length, `${token} should be declared for light and dark`).toBe(2);
    }
  });

  it("keeps elevation in the tokens, not in the components", () => {
    /*
     * The same rule the colours have, for the same reason: a raw shadow written into a component
     * is a design decision nobody can find later, and this design now leans on elevation to do
     * what a 1px border used to do. Tailwind's arbitrary `shadow-[...]` is the same mistake in a
     * different spelling, so both are refused.
     */
    const dir = path.join(process.cwd(), "src");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx?|css)$/.test(entry.name) && entry.name !== "globals.css") files.push(full);
      }
    };
    walk(dir);

    const offenders = files.filter((f) => {
      const text = fs.readFileSync(f, "utf8");
      return /box-shadow:/.test(text) || /shadow-\[/.test(text);
    });
    expect(offenders, "use var(--elev-1) / var(--elev-2) instead").toEqual([]);
  });

  it("names faces that the layout actually publishes", () => {
    // The other half of the same bug: the stylesheet can name a variable nothing defines and
    // fail exactly as quietly. So this checks the pair rather than either side.
    const layout = fs.readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    for (const face of ["--font-geist-sans", "--font-geist-mono"]) {
      expect(CSS, `globals.css should use ${face}`).toContain(`var(${face})`);
      expect(layout, `layout.tsx should publish ${face}`).toContain(face);
    }
  });
});
