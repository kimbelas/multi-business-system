import { test as setup, expect } from "@playwright/test";

import { rlsEnv, rlsFullyConfigured, setUpFixture, PERSONAS } from "../tests-rls/harness";

import {
  authPaths,
  ensureAuthDir,
  signInThroughForm,
  writeManifest,
  type FixtureManifest,
  type PersonaName,
} from "./authed";

/**
 * Create the personas once, and leave a browser session on disk for each.
 *
 * A Playwright setup project rather than `globalSetup`, because this needs a real browser: the
 * session is whatever the login form produces, and the point is to exercise that rather than to
 * approximate it.
 *
 * The accounts and the tenancy come from `tests-rls/harness.ts`, so both suites agree on who the
 * personas are and what they can reach. `setUpFixture` also returns a teardown closure, which is
 * useless across processes - hence the manifest of ids that `auth.teardown.ts` deletes by.
 */

setup("create personas and sign each of them in", async ({ browser }) => {
  /*
   * Skipped, not failed, when the credentials are absent - a fork with no secrets should be able to
   * run CI. The `rls` job proves the other half of this rule: where the suite is SUPPOSED to run,
   * the workflow refuses a partial credential set rather than letting it skip to green.
   *
   * `rlsFullyConfigured` rather than `rlsEnv() === null`, and NOT at module scope. The e2e job
   * gives two of the three variables placeholder values so the middleware can construct a client,
   * which makes the set partial on a fork - and `rlsEnv` throws on a partial set. At module scope
   * that throw is a collection error: every project red, before anything runs.
   */
  setup.skip(!rlsFullyConfigured(), "needs the three Supabase credentials");
  setup.setTimeout(180_000);

  const fixture = await setUpFixture(rlsEnv()!);
  ensureAuthDir();

  const personas = {} as FixtureManifest["personas"];
  for (const name of PERSONAS) {
    const persona = fixture.personas[name];
    personas[name] = {
      userId: persona.userId,
      email: persona.email,
      password: persona.password,
    };
  }

  /*
   * The manifest is written BEFORE any sign-in.
   *
   * If a sign-in fails, these rows exist and the teardown project has to be able to remove them.
   * Writing it afterwards would leak five auth users and an organisation on exactly the run that
   * went wrong, which is the run you least want to be cleaning up by hand.
   */
  writeManifest({
    runId: fixture.runId,
    orgId: fixture.orgId,
    branchA: fixture.branchA,
    branchB: fixture.branchB,
    otherOrgId: fixture.otherOrgId,
    otherBranchId: fixture.otherBranchId,
    businessIds: Object.values(fixture.businesses),
    branchIds: [fixture.branchA, fixture.branchB, fixture.otherBranchId],
    userIds: PERSONAS.map((name) => fixture.personas[name].userId),
    personas,
  });

  for (const name of PERSONAS) {
    const { email, password } = personas[name as PersonaName];

    // A fresh context per persona: one storage state each, and no cookie carried between them.
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInThroughForm(page, email, password);

    /*
     * `signInThroughForm` already waited for the URL to leave /login, so re-asserting it here
     * proves nothing - it was a check that could not fail. What actually needs asserting is the
     * artefact every spec depends on: `storageState` writes a file whether or not it contains a
     * session, and `authed.ts` deliberately falls back to no session when that file is missing. An
     * empty one would sail past both and produce nine confusing failures.
     */
    const state = await context.storageState({ path: authPaths.STATE(name) });
    const cookies = state.cookies.filter((cookie) => cookie.name.startsWith("sb-"));
    expect(cookies, `${name} signed in but no Supabase cookie was stored`).not.toHaveLength(0);
    await context.close();
  }
});
