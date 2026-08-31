import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing in `src/` may name a type that only exists after a build.
 *
 * ## Why this is a scan and not a compiler setting
 *
 * `next-env.d.ts` is generated, gitignored, and imports `.next/dev/types/routes.d.ts`, which
 * declares LayoutProps and PageProps as globals. An explicit import pulls a file into the program
 * regardless of `include` or `exclude`, so no tsconfig change can make `pnpm typecheck` agree with
 * CI: locally the file exists and the globals resolve, and in a fresh checkout it was never
 * generated, so they do not.
 *
 * That difference cost twelve consecutive red CI runs and twelve skipped deploys. `layout.tsx`
 * used the generated layout props type, typecheck passed on every developer machine, and CI failed
 * with `TS2304: Cannot find name` every single time. Nothing else in the pipeline said so, because
 * `deploy.yml` fires on a green CI and a skipped deploy looks like nothing happening.
 *
 * Two attempted fixes were asserted and then disproved by putting the type back and watching
 * typecheck still pass. Dropping the generated directories from `include` did nothing, because the
 * recursive TypeScript globs reach into `.next` regardless. Adding `.next` to `exclude` did nothing
 * either, because the import in `next-env.d.ts` outranks both. Hence this: the one check that runs
 * where the mistake is made.
 *
 * The generated route types are genuinely convenient. Route params typed by hand are four lines,
 * and they compile in a fresh checkout.
 */

const GENERATED_GLOBALS = ["LayoutProps", "PageProps", "RouteContext", "AppRoutes", "ParamMap"];

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const COMMENT_LINE = /^\s*(\/\/|\*)/;

/**
 * Comments stripped, because this is about code and not about prose.
 *
 * `layout.tsx` carries a note explaining why it does not use the generated type, and the first
 * version of this scan flagged that note as the violation. Same trap as the palette test, which
 * flagged the comment quoting the violet it had removed, and the theme test, which flagged the
 * comment quoting the self-reference it had fixed. Three times now, so it is worth saying plainly:
 * a scanner that reads comments audits the documentation rather than the program.
 */
function withoutComments(source: string): string {
  return source
    .replace(BLOCK_COMMENT, "")
    .split("\n")
    .filter((line) => !COMMENT_LINE.test(line))
    .join("\n");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("generated Next types", () => {
  const files = sourceFiles(path.join(process.cwd(), "src"));

  it("finds the source files it means to check", () => {
    // A guard that guards nothing is the defect shape this repo keeps producing, so the scan
    // proves it scanned something before reporting that it found nothing wrong.
    expect(files.length).toBeGreaterThan(10);
  });

  it("strips comments before scanning", () => {
    // The stripping is load-bearing, so it gets its own assertion rather than being trusted.
    const sample = [
      "/* LayoutProps in a block */",
      "// LayoutProps in a line",
      "const x = 1;",
    ].join("\n");
    expect(withoutComments(sample)).not.toContain("LayoutProps");
    expect(withoutComments(sample)).toContain("const x = 1;");
  });

  it.each(GENERATED_GLOBALS)("no file in src/ names %s", (name) => {
    const pattern = new RegExp(`\\b${name}\\b`);
    const offenders = files
      .filter((file) => pattern.test(withoutComments(fs.readFileSync(file, "utf8"))))
      .map((file) => path.relative(process.cwd(), file).split(path.sep).join("/"));
    expect(offenders).toEqual([]);
  });

  it("does not rely on next-env.d.ts being present", () => {
    // The file is gitignored, so CI never has it. If anything in src/ ever needs it, that is the
    // same bug in a new place.
    const ignored = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");
    expect(ignored).toContain("next-env.d.ts");
  });
});
