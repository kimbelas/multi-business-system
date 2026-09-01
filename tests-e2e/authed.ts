import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { test as base, type Page } from "@playwright/test";

import { rlsFullyConfigured } from "../tests-rls/harness";

/**
 * Signing in, for the specs that need a session.
 *
 * Everything behind the login had been verified by typecheck, lint, unit tests and the policy
 * suite, and never rendered. The e2e suite drove only `/login` and `/preview`, both
 * unauthenticated, so the settings screen, the roster, the invite form, the revoke dialog and the
 * create forms had never been displayed to anything. Two failures in that code were found by
 * reading and measuring it — a 390px overflow and a 1.92:1 contrast on a destructive button — and
 * both were invisible to every gate the repository has.
 *
 * ## How a persona gets a browser session
 *
 * Through the login form, not by minting a token beside it. Signing in with the Supabase client
 * and injecting the cookie would test a session this app never creates: the real one is set by
 * `@supabase/ssr` inside a server action and refreshed by the middleware, and that path is the one
 * that can break.
 *
 * The accounts come from `tests-rls/harness.ts` rather than a second fixture, which is why that
 * file now exposes the generated password. One definition of "who the personas are" for both
 * suites.
 */

/** Where `auth.setup.ts` leaves each persona's cookies, and what the fixture created. */
const DIR = path.join(process.cwd(), "tests-e2e", ".auth");
const STATE = (name: string) => path.join(DIR, `${name}.json`);
const MANIFEST = path.join(DIR, "fixture.json");

export type PersonaName = "owner" | "managerA" | "staffA" | "staffB" | "outsider";

/** Only what a spec needs to talk about. Ids so teardown can delete exactly what was made. */
export interface FixtureManifest {
  runId: string;
  orgId: string;
  /** As inserted, so a spec can assert the header shows it without rebuilding the name. */
  orgName: string;
  branchA: string;
  branchB: string;
  otherOrgId: string;
  otherBranchId: string;
  businessIds: string[];
  branchIds: string[];
  userIds: string[];
  personas: Record<PersonaName, { userId: string; email: string; password: string }>;
}

export const authPaths = { DIR, STATE, MANIFEST };

export function ensureAuthDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

export function writeManifest(manifest: FixtureManifest) {
  ensureAuthDir();
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
}

/**
 * `null` when the suite has nothing to run against, so callers skip rather than fail.
 *
 * The same rule `rlsEnv` carries and for the same reason: a suite reporting green against no
 * database is worse than no suite. The difference here is that a missing manifest also means the
 * setup project did not run, which is worth distinguishing from "no credentials".
 */
export function stateExists(persona: PersonaName): boolean {
  return existsSync(STATE(persona));
}

export function readManifest(): FixtureManifest | null {
  if (!existsSync(MANIFEST)) return null;
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as FixtureManifest;
}

/** Sign in through the form the app actually uses, and confirm we landed inside. */
export async function signInThroughForm(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  /*
   * Waiting for the URL to stop being /login, rather than for a selector on the next screen.
   *
   * Which screen that is depends on the persona: a staff member with one branch is redirected to
   * their branch home, an owner gets the list. Asserting on either would make this fixture know
   * something only the pages should.
   */
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/**
 * `test` with a `persona` fixture: `test.use({ persona: "owner" })`.
 *
 * The storage state is applied per test rather than per project, so one spec file can assert what
 * an owner sees and what a staff member is refused without splitting into two files whose
 * relationship is a naming convention.
 */
export const test = base.extend<{
  persona: PersonaName;
  manifest: FixtureManifest;
  fixtureGuard: void;
}>({
  persona: ["owner", { option: true }],

  /*
   * The guard, as an auto fixture rather than a function every spec has to remember to call.
   *
   * It was `requireFixture()` at module scope, and a new `*.authed.spec.ts` that forgot it would run
   * with no session and assert against the login page - passing for any negative assertion. This
   * project's own rule is that a guard needs a test at its call site; Playwright's answer is
   * `{ auto: true }`, which removes the call site entirely.
   */
  fixtureGuard: [
    async ({ persona }, provide) => {
      /*
       * The credentials decide first, and nothing else does.
       *
       * Keyed on all three variables being present rather than on `rlsEnv`, which throws on a
       * partial set - and the e2e job's placeholders make that set partial on a fork by design.
       *
       * Asking the credentials BEFORE the manifest also settles a case an earlier order got wrong.
       * `tests-e2e/.auth` survives any run where the credentials are absent, because both the setup
       * and the teardown skip before touching it - so on a machine that once had them, a stale
       * manifest would satisfy the guard and these tests would run against accounts that no longer
       * exist.
       */
      if (!rlsFullyConfigured()) {
        base.skip(true, "needs the personas the auth setup project creates");
        await provide();
        return;
      }

      /*
       * From here the setup must have produced both artefacts. Both, not just the manifest: they are
       * written at different times - the manifest before any sign-in, each `<persona>.json` after
       * that persona's - so a present manifest is not evidence that THIS test's browser has a
       * session, and `storageState` below falls back to no session rather than throwing.
       */
      if (readManifest() === null) {
        throw new Error(
          "The Supabase credentials are configured, so the auth setup project should have written " +
            "tests-e2e/.auth/fixture.json. It is absent, which means the setup did not run or did " +
            "not finish. These tests must not skip to green where they are supposed to run.",
        );
      }
      if (!stateExists(persona)) {
        throw new Error(
          `The fixture exists but tests-e2e/.auth/${persona}.json does not, so this test would ` +
            "run with no session and assert against the login page instead.",
        );
      }

      await provide();
    },
    { auto: true },
  ],

  /*
   * The second parameter is named `provide`, not `use`.
   *
   * Playwright does not care what it is called, and `eslint-plugin-react-hooks` reads a bare `use`
   * as React's hook - "called in function that is neither a React component nor a custom Hook".
   * Renaming beats a suppression: an eslint-disable here would also silence a real rules-of-hooks
   * violation if this file ever grew one.
   */
  storageState: async ({ persona }, provide) => {
    /*
     * `undefined` when the file is absent, which means the setup project skipped for want of
     * credentials. Handing Playwright a path that does not exist throws while the context is being
     * built - before any `test.skip` can run - so the whole project would go red on a fork instead
     * of quietly not applying. The specs skip on the missing manifest instead.
     */
    const file = STATE(persona);
    await provide(existsSync(file) ? file : undefined);
  },

  manifest: async ({}, provide) => {
    const manifest = readManifest();
    if (!manifest) throw new Error("no fixture manifest - the auth setup project did not run");
    await provide(manifest);
  },
});

export { expect } from "@playwright/test";
