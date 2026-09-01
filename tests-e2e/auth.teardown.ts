import { rmSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { test as teardown } from "@playwright/test";

import { rlsEnv } from "../tests-rls/harness";

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

const env = rlsEnv();

teardown("remove the personas and their organisation", async () => {
  teardown.skip(env === null, "nothing was created");
  teardown.setTimeout(120_000);

  const manifest = readManifest();
  if (!manifest) return;

  const admin = createClient(env!.url, env!.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /*
   * Children first: memberships reference branches and organisations, branches reference
   * businesses. The auth users go last, so a failure part-way leaves no grant pointing at an
   * account that no longer exists.
   */
  for (const orgId of [manifest.orgId, manifest.otherOrgId]) {
    await admin.from("memberships").delete().eq("org_id", orgId);
  }
  for (const id of manifest.branchIds) await admin.from("branches").delete().eq("id", id);
  for (const id of manifest.businessIds) await admin.from("businesses").delete().eq("id", id);
  for (const id of [manifest.orgId, manifest.otherOrgId]) {
    await admin.from("organizations").delete().eq("id", id);
  }

  /*
   * Any business or branch a SPEC created is caught by the org-scoped sweep above for memberships,
   * but businesses and branches added by the create forms are not in the manifest — they did not
   * exist when it was written. Removed by their organisation, which is the only handle there is.
   */
  for (const orgId of [manifest.orgId, manifest.otherOrgId]) {
    const { data: leftover } = await admin.from("businesses").select("id").eq("org_id", orgId);
    for (const row of leftover ?? []) await admin.from("businesses").delete().eq("id", row.id);
  }

  for (const id of manifest.userIds) await admin.auth.admin.deleteUser(id);

  // The cookies are per-run and name accounts that no longer exist.
  rmSync(authPaths.DIR, { recursive: true, force: true });
});
