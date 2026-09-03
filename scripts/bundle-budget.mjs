/**
 * Measure the Worker bundle and fail if it is over budget.
 *
 *   pnpm bundle:budget                     # builds nothing; expects a build to exist
 *   pnpm exec wrangler deploy --dry-run 2>&1 | pnpm bundle:budget
 *
 * Card 0015. The thresholds and the arithmetic live in `tests/support/bundle-budget.ts` so that
 * `tests/bundle-budget.test.ts` asserts the same code this runs - including the case that matters
 * most, which is an output this cannot read. The awk this replaces passed that case.
 *
 * `wrangler deploy --dry-run` is what reports the number Cloudflare actually counts: every module
 * in the Worker, gzipped. NOT the size of `.open-next/worker.js`, which is a 2 KB entry point
 * importing a 25 MB server bundle - measuring that reported 746 bytes against a 3 MiB limit and
 * would never have fired.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { decide, parseGzipKiB } from "../tests/support/bundle-budget.ts";

/** Piped input when there is any, so CI can measure once and reuse the output. */
function fromStdin() {
  try {
    const piped = readFileSync(0, "utf8");
    return piped.trim().length > 0 ? piped : null;
  } catch {
    return null;
  }
}

function fromWrangler() {
  try {
    // stderr merged: wrangler prints the upload summary there on some versions, and reading only
    // stdout is how this ends up with nothing to parse.
    return execFileSync("wrangler", ["deploy", "--dry-run"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
  } catch (error) {
    /*
     * A failed wrangler is not an absent measurement - it is a broken build, and its own output is
     * the useful thing to print. Returning the combined streams lets the parse fail loudly below
     * rather than this throwing something less legible.
     */
    const merged = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    process.stderr.write(merged);
    return merged;
  }
}

const output = fromStdin() ?? fromWrangler();
const verdict = decide(parseGzipKiB(output));

process.stdout.write(`${verdict.message}\n`);

/*
 * GitHub's annotation syntax, so a failure lands on the run rather than only in the log. Harmless
 * anywhere else - it is a line of text.
 */
if (!verdict.ok) {
  process.stdout.write(`::error::${verdict.message}\n`);
  process.exit(1);
}
if (verdict.level === "warn") {
  process.stdout.write(`::warning::${verdict.message}\n`);
}
