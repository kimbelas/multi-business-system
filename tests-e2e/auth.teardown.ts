import { rmSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { expect, test as teardown } from "@playwright/test";

import { rlsEnv, rlsFullyConfigured } from "../tests-rls/harness";

import { authPaths, readManifest } from "./authed";

/**
 * Delete exactly what the setup created, and nothing else.
 *
 * By recorded id in every case — no `delete from` without a filter, no cleanup by name pattern that
 * could catch a real row. This suite points at a development project, and the accounts it makes are
 * real accounts; the harness carries the same rule for the same reason.
 *
 * Runs as a project `teardown`, so it happens even when specs fail. That is the case that matters:
 * a green run leaving rows behind is untidy, and a red run leaving five auth users and an
 * organisation behind is somebody's afternoon.
 */

teardown("remove the personas and their organisation", async () => {
  teardown.skip(!rlsFullyConfigured(), "nothing was created");
  teardown.setTimeout(120_000);

  const manifest = readManifest();
  /*
   * A missing manifest here is a failure, not "nothing to do".
   *
   * The credentials are present - the skip above proved it - so the setup project ran, and the
   * manifest is written before any sign-in. Its absence means `setUpFixture` threw part-way, and
   * that function's own rollback is `await teardown().catch(() => {})`: swallowed, and unchecked
   * even if it had not been. So this is the last place anything can notice, and returning success
   * would be the third silent green in a file whose whole job is not leaving real accounts behind.
   */
  if (!manifest) {
    throw new Error(
      "The credentials are configured, so the setup should have written tests-e2e/.auth/" +
        "fixture.json before signing anybody in. It is absent, which means the fixture threw " +
        "part-way and may have left rows in a real project that nothing here can name.",
    );
  }

  const env = rlsEnv()!;
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /*
   * Every failure is collected and asserted at the end, because NONE of these calls throws.
   * postgrest-js resolves with `{ error }` and GoTrue's admin API with `{ data, error }`, so a
   * discarded result is a delete that silently did not happen.
   *
   * This project has already written that lesson down once, in `settings/actions.ts`: a
   * `deleteUser` whose result was thrown away, reporting "the account was removed" without having
   * looked. Here it is worse. A teardown that cannot fail is a leak detector that reports clean
   * while two organisations and five real auth users stay in a real project - and the `rmSync`
   * below used to run regardless, destroying the only record of which rows they were.
   */
  const failures: string[] = [];
  const record = (what: string, error: { message: string } | null) => {
    if (error) failures.push(`${what}: ${error.message}`);
  };

  /*
   * Children first: memberships reference branches and organisations, branches reference
   * businesses. The auth users go last, so a failure part-way leaves no grant pointing at an
   * account that no longer exists.
   *
   * The users depend on the organisations for a reason the ordering does not show:
   * `organizations.owner_id` references `profiles(id)` with no `on delete` clause, and
   * `profiles.id` cascades from `auth.users`. Both fixture organisations name the owner persona, so
   * deleting that account is possible only once both organisations are gone. If an organisation
   * delete fails, the owner's account cannot be removed either - which is exactly why these
   * failures are collected rather than assumed.
   */
  for (const orgId of [manifest.orgId, manifest.otherOrgId]) {
    record(
      `memberships of ${orgId}`,
      (await admin.from("memberships").delete().eq("org_id", orgId)).error,
    );
  }
  for (const id of manifest.branchIds) {
    record(`branch ${id}`, (await admin.from("branches").delete().eq("id", id)).error);
  }
  for (const id of manifest.businessIds) {
    record(`business ${id}`, (await admin.from("businesses").delete().eq("id", id)).error);
  }

  /*
   * Anything a SPEC created, swept by organisation - businesses added through the create form were
   * not in the manifest, because they did not exist when it was written.
   *
   * This runs BEFORE the organisations are deleted, and that ordering is the whole point. It used
   * to sit after them, where `businesses.org_id` had already cascaded: the select returned zero
   * rows on every run and the block could never once do the job its comment claimed. A guard that
   * cannot fire, in the commit written to fix a guard that could not fail.
   *
   * Their branches cascade from `businesses.business_id`, so there is no second sweep to write.
   */
  for (const orgId of [manifest.orgId, manifest.otherOrgId]) {
    const { data: leftover, error } = await admin
      .from("businesses")
      .select("id")
      .eq("org_id", orgId);
    record(`sweep of ${orgId}`, error);
    for (const row of leftover ?? []) {
      record(
        `swept business ${row.id}`,
        (await admin.from("businesses").delete().eq("id", row.id)).error,
      );
    }
  }

  for (const id of [manifest.orgId, manifest.otherOrgId]) {
    record(`organisation ${id}`, (await admin.from("organizations").delete().eq("id", id)).error);
  }

  for (const id of manifest.userIds) {
    record(`auth user ${id}`, (await admin.auth.admin.deleteUser(id)).error);
  }

  /*
   * The manifest survives a failed teardown, deliberately. It is the only record of which
   * organisations, businesses, branches and accounts exist, and the alternative to having it is
   * cleaning a live project by name pattern - which the harness forbids for good reason.
   */
  if (failures.length === 0) {
    rmSync(authPaths.DIR, { recursive: true, force: true });
  }

  expect(failures, "the teardown left rows behind; tests-e2e/.auth names them").toEqual([]);
});
