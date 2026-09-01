import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { rlsEnv } from "./harness";

/**
 * The auth configuration, asked of the project rather than of the code.
 *
 * Card 0028 asks for "email and password sign-in through Supabase Auth, **with public signup
 * disabled**". Two things were verifying that, and neither of them checked it.
 *
 * `deployed.spec.ts` asserts the login page offers no signup link, and `tests/rbac.test.ts` asserts
 * the app has no signup route. Both are true and neither is the claim. The anon key is public by
 * design — it ships inside the client bundle, which is what makes RLS the authorization layer
 * rather than the key — so anybody who loads the app can call `/auth/v1/signup` with it directly.
 * Whether that succeeds is a setting in the project, not a fact about this repository, and it is
 * the difference between "there is no signup screen" and "there is no signup".
 *
 * A render-time check standing in for a server-side one is the same substitution this codebase
 * already refused for authorization: **"render-time gating is not a security boundary."** So this
 * asks GoTrue.
 *
 * It lives here rather than in `pnpm test` because it needs the real project, and here rather than
 * in the e2e suite because it is not about a screen. Note that the `rls` job runs on
 * `pull_request`, `schedule` and `workflow_dispatch` — not on a push to main — so a change to this
 * file is proved by a pull request or a dispatch, never by watching main go green.
 */

const env = rlsEnv();
const describeAuth = env ? describe : describe.skip;

describeAuth("the project's auth configuration", () => {
  it("refuses a public signup through the anon key", async () => {
    const anon = createClient(env!.url, env!.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    /*
     * A random address, so a pass means "refused" rather than "already taken" — the two are
     * different answers and only one of them is the setting under test.
     *
     * Nothing to clean up when this passes, which is the point of asserting on the error. If it
     * ever fails it will have created an account, and that account IS the finding: leaving it for a
     * human to see beats deleting the only evidence. The address says where it came from.
     */
    const email = `signup-probe-${randomUUID().slice(0, 8)}@example.com`;
    const { data, error } = await anon.auth.signUp({
      email,
      password: `Probe-${randomUUID()}`,
    });

    /*
     * GoTrue's wording for a disabled signup has changed across versions ("Signups not allowed for
     * this instance", and a 422 in newer builds), so the assertion is that it refused and produced
     * no session — not the sentence it refused with. A test pinned to the phrasing would go red on
     * an upgrade and teach everyone to loosen it.
     */
    expect(error, "public signup should be refused: anyone can read the anon key").not.toBeNull();
    expect(data.session, "a refused signup must not hand back a session").toBeNull();

    /*
     * And no user, which is a separate claim. With email confirmation ON but signups still allowed,
     * GoTrue returns a user and no session, and asserting only on the session above would read that
     * as a pass — an unconfirmed account is still an account somebody created without an invitation.
     */
    expect(data.user, `signup created ${email}; public signup is NOT disabled`).toBeNull();
  });
});
