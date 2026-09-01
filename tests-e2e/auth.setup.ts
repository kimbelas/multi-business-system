import { test as setup, expect } from "@playwright/test";

import { rlsEnv, setUpFixture, PERSONAS } from "../tests-rls/harness";

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

const env = rlsEnv();

setup("create personas and sign each of them in", async ({ browser }) => {
  /*
   * Skipped, not failed, when the credentials are absent - a fork with no secrets should be able to
   * run CI. The `rls` job proves the other half of this rule: where the suite is SUPPOSED to run,
   * the workflow refuses a partial credential set rather than letting it skip to green.
   */
  setup.skip(env === null, "needs the three Supabase credentials");
  setup.setTimeout(180_000);

  const fixture = await setUpFixture(env!);
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

    // The session is real only if the middleware let us past it, so assert that rather than the
    // presence of a cookie - `getUser()` verifying the token is the whole point of that gate.
    await expect(page).not.toHaveURL(/\/login/);

    await context.storageState({ path: authPaths.STATE(name) });
    await context.close();
  }
});
