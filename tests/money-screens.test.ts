import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * No screen shows a peso figure without saying which branch it belongs to.
 *
 * Card 0004's first criterion, second half. The first half is a screen an owner lands on that names
 * the selected branch, and that one is asserted in a browser; this one is a rule about screens that
 * mostly **do not exist yet** - the money and laundry phases are ahead of us - so asserting it only
 * where it currently applies would leave a note where a check belongs.
 *
 * The plan's own risk register says the four-tap rule loses to every feature that wants one more
 * field, and that the erosion is invisible per commit; the mitigation it names is to treat a
 * regression as a failing check rather than a note. This is that, for attribution: a new screen
 * that renders a figure has to say, here, in one line, where its branch name comes from. The test
 * cannot read the sentence and know it is true - what it can do is refuse to let a money screen
 * appear without somebody having answered the question.
 *
 * ## How a screen is found
 *
 * By the peso sign, through the import graph. A route shows money if `₱` appears anywhere in the
 * modules it reaches - `components/ui/peso.tsx`, the keypad's amount display, or a literal in the
 * page itself. Coarse on purpose: a comment mentioning the symbol would register a screen that does
 * not show one, which costs a line in the table below, where the opposite mistake costs the
 * criterion. Erring is only safe in one direction.
 */

const SRC = path.resolve(import.meta.dirname, "..", "src");

/**
 * Every route that renders a figure, and where that figure's branch comes from.
 *
 * Add a line when the test tells you to, and make it say which element on the screen names the
 * branch at every width - not that it ought to.
 */
const ATTRIBUTION: Record<string, string> = {
  "app/preview/page.tsx":
    "Three artboards, each named. The counter carries `businessName · branchName` in its own first " +
    "line below sm, where the shell's top bar is hidden, and the bar names it from sm up. The " +
    "dashboard is a roll-up across businesses rather than a branch screen: its shell says 'All " +
    "branches', its subtitle counts them, and every figure inside it is attributed by business in " +
    "the share bar and the by-business table.",
};

/** Files that are the entry point of a route. */
function routeFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, found);
    else if (entry === "page.tsx") found.push(full);
  }
  return found;
}

/**
 * What this module imports, as absolute paths inside `src`.
 *
 * Anything that does not resolve to a file under `src` is somebody else's code and cannot be the
 * reason a peso reaches the screen.
 */
function localImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
  const resolved: string[] = [];

  for (const specifier of specifiers) {
    const base = specifier.startsWith("@/")
      ? path.join(SRC, specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(file), specifier)
        : null;
    if (base === null) continue;

    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ]) {
      try {
        if (statSync(candidate).isFile()) {
          resolved.push(candidate);
          break;
        }
      } catch {
        // Not that spelling. The loop tries the next one, and a specifier that resolves to nothing
        // is a broken import that typecheck fails on long before this test runs.
      }
    }
  }

  return resolved;
}

/**
 * Everything a route reaches, including the layouts wrapped around it.
 *
 * The layouts are in here because one of them could render a figure - the shell is where a running
 * total would be tempting to put - and a graph that started at the page would not see it.
 */
function closureOf(route: string): Set<string> {
  const seen = new Set<string>();
  const queue = [route];

  for (let dir = path.dirname(route); dir.startsWith(SRC); dir = path.dirname(dir)) {
    for (const name of ["layout.tsx", "layout.ts"]) {
      const layout = path.join(dir, name);
      try {
        if (statSync(layout).isFile()) queue.push(layout);
      } catch {
        // Most directories have no layout.
      }
    }
  }

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...localImports(file));
  }

  return seen;
}

describe("every screen that shows money says whose money it is", () => {
  const moneyRoutes = routeFiles(path.join(SRC, "app"))
    .filter((route) =>
      [...closureOf(route)].some((file) => readFileSync(file, "utf8").includes("₱")),
    )
    .map((route) => path.relative(SRC, route).split(path.sep).join("/"))
    .sort();

  it("finds the peso sign at all, so this suite can fail", () => {
    /*
     * The guard on the guard. Every assertion below is a comparison between two sets, and both go
     * empty together if the detector breaks - a change to how the symbol is rendered, a move of the
     * app directory, an import syntax the regex does not match. The suite would then agree with
     * itself and assert nothing, which is the shape this repository has now found five times.
     */
    expect(
      moneyRoutes.length,
      "no route renders a peso, which cannot be right yet",
    ).toBeGreaterThan(0);
  });

  it("has an attribution recorded for each of them", () => {
    const unrecorded = moneyRoutes.filter((route) => !ATTRIBUTION[route]);
    expect(
      unrecorded,
      "These routes render a peso figure and nothing here says which branch it belongs to. " +
        "Name the element that carries the branch at every width - remember the shell's top bar " +
        "is hidden below sm, so a screen that relies on it says nothing on a phone - and add a " +
        "line to ATTRIBUTION in this file. Card 0004: a figure nobody can attribute is worse " +
        "than no figure.",
    ).toEqual([]);
  });

  it("has no attribution left behind by a screen that no longer shows money", () => {
    // Otherwise the table becomes a list of claims about screens that have changed, which is how a
    // check turns back into a note.
    const stale = Object.keys(ATTRIBUTION).filter((route) => !moneyRoutes.includes(route));
    expect(stale, "these no longer render a figure; drop their lines").toEqual([]);
  });
});
