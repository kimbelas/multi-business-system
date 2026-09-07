import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CI_PLACEHOLDER_PREFIX, isCiPlaceholder } from "./support/ci-placeholder";

/**
 * The e2e job can start the server, and its placeholders still read as "not configured".
 *
 * Two rules that only hold together, spelled in two files that cannot see each other.
 *
 * `instrumentation.ts` calls `serverEnv()` on the first request, so `next dev` needs every variable
 * in `lib/env.ts`'s `REQUIRED` list. The e2e job supplies them from repository secrets and falls
 * back to placeholders when a secret is absent - on a fork, or a clone nobody has configured. Miss
 * one and the fork's run is not a skipped project but a server that exits 1 and twenty-odd specs
 * failing at "connection refused", which reads as a broken app.
 *
 * The other rule pulls the other way. `rlsFullyConfigured` asks whether the three Supabase
 * variables are real, and a placeholder is present enough to fool a presence check - which would
 * send the authenticated specs to create accounts in a project that does not exist. So the
 * placeholder has to be recognisable as one, and that recognition is a string prefix agreed
 * between a TypeScript constant and a YAML file.
 *
 * Neither rule can be checked by typescript, lint or a passing run on this repository, because the
 * repository has all the secrets: every fallback here is dead code until somebody forks. The
 * failure would appear on a machine none of us is looking at. Hence a test.
 *
 * Both lists are read from the files that own them - `REQUIRED` from `lib/env.ts` and the floor
 * from the check beside it - rather than copied here, so adding a fifth required variable fails
 * this test instead of a fork's CI.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

const CI_YML = readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const ENV_TS = readFileSync(path.join(ROOT, "src", "lib", "env.ts"), "utf8");

/** The `REQUIRED` array in `lib/env.ts`, read rather than restated. */
function requiredVariables(): string[] {
  const block = /const REQUIRED = \[([\s\S]*?)\] as const;/.exec(ENV_TS);
  if (!block) throw new Error("lib/env.ts no longer declares `const REQUIRED = [...] as const;`");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The minimum length `lib/env.ts` enforces on CRON_SECRET. */
function cronSecretFloor(): number {
  const floor = /CRON_SECRET[\s\S]{0,40}?\.length < (\d+)/.exec(ENV_TS);
  if (!floor) throw new Error("lib/env.ts no longer checks CRON_SECRET's length");
  return Number(floor[1]);
}

/**
 * The step that runs a server, and only that step.
 *
 * The `bundle` job's env is a different question - a build reads `NEXT_PUBLIC_*` and nothing else,
 * and `register()` does not run during `next build`, which is why that job needs no CRON_SECRET.
 */
function endToEndStepEnv(): string {
  const step = /name: End-to-end tests[\s\S]*?\n        env:\n([\s\S]*?)(?=\n  [a-z])/.exec(CI_YML);
  if (!step) throw new Error("ci.yml no longer has an `End-to-end tests` step with an env block");
  return step[1];
}

/** `NAME: ${{ secrets.NAME || 'fallback' }}` → the fallback, by variable name. */
function fallbacks(env: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of env.matchAll(/^\s*([A-Z0-9_]+):\s*\$\{\{[^}]*?\|\|\s*'([^']*)'\s*\}\}/gm)) {
    found.set(m[1], m[2]);
  }
  return found;
}

describe("the e2e job's placeholder credentials", () => {
  const env = endToEndStepEnv();
  const fallback = fallbacks(env);

  it.each(requiredVariables())(
    "gives %s a value even when the secret is absent, so the dev server starts",
    (name) => {
      expect(fallback.get(name) ?? null).not.toBeNull();
    },
  );

  it("marks the two credentials as placeholders, so the authenticated specs still skip", () => {
    // Not the URL: `http://127.0.0.1:54321` is a real address a local Supabase answers on, and
    // `rlsFullyConfigured` is false on the strength of the other two. A prefix on a URL would have
    // to be a valid URL as well, which is a worse trade than naming the two that decide.
    const credentials = ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
    const notMarked = credentials.filter((name) => !isCiPlaceholder(fallback.get(name)));
    expect(notMarked).toEqual([]);
  });

  it("uses a CRON_SECRET placeholder long enough for lib/env.ts to accept", () => {
    const value = fallback.get("CRON_SECRET") ?? "";
    expect(value.length).toBeGreaterThanOrEqual(cronSecretFloor());
  });

  it("spells the prefix the way the constant does", () => {
    // The whole convention is one string in two languages. `toEqual` on the list prints what it
    // found, where a count would print a number and leave the misspelling to be guessed at.
    const placeholders = [...fallback.values()].filter((v) => v.includes("placeholder"));
    expect(placeholders.filter((v) => !v.startsWith(CI_PLACEHOLDER_PREFIX))).toEqual([]);
  });
});
