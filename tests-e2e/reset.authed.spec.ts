import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type Browser, type Page } from "@playwright/test";

import { rlsEnv } from "../tests-rls/harness";

import { expect, test } from "./authed";

/**
 * Password reset, driven end to end without an inbox.
 *
 * Card 0028's last criterion. It sat unticked on the argument that the flow needs SMTP, and that
 * turned out to be true of the *email* and not of the flow: `auth.admin.generateLink` mints a real
 * recovery token and returns it instead of sending it, so everything after the mail - the token,
 * `/auth/confirm`, the session it creates, the password that gets written - is testable exactly as
 * a person would experience it. What SMTP buys is the delivery, and delivery is the one part no
 * test of ours could assert anyway.
 *
 * ## Why every test builds its own context
 *
 * `authed.ts` applies a persona's storage state, and this whole flow belongs to somebody who is
 * *not* signed in - a signed-in user is redirected away from `/login` by the middleware, which is
 * correct and would make these tests assert against the wrong page. Building the context here also
 * lets one test hold two independent ones: the browser that resets, and the browser that then signs
 * in with the result.
 *
 * It has to be `anonContext` below rather than a bare `browser.newContext()`, and that distinction
 * cost four red tests - see the note on that function.
 *
 * The file is still `.authed.spec.ts` because it needs the credentials and the fixture guard that
 * comes with that project - not because it needs a session.
 */

/**
 * A browser carrying no session at all.
 *
 * `browser.newContext()` looked like the unambiguous way to get one and is not: a context created
 * inside a test **inherits that test's context options**, and `authed.ts` sets `storageState` to a
 * persona's saved session. So every "fresh" context here arrived signed in as the owner, the
 * middleware bounced `/login` straight to `/` - correctly - and `waitForURL` waited out the full
 * thirty seconds against the app shell. Four tests failed that way and the error each reported was
 * `browserContext.close: Test ended`, from the `finally`, which is the timeout's error and not the
 * cause.
 *
 * An explicitly empty state overrides the inherited one. `storageState: undefined` does not: it
 * reads as "not specified", which is exactly what inherits.
 */
function anonContext(browser: Browser) {
  return browser.newContext({ storageState: { cookies: [], origins: [] } });
}

/**
 * The alerts this app raised, and not the one the framework puts on every page.
 *
 * Next injects `<div role="alert" aria-live="assertive" id="__next-route-announcer__">` into every
 * route to announce navigations, so `getByRole("alert")` always matches at least one element -
 * strict mode fails on the assertions that expect one, and `toHaveCount(0)` can never be satisfied
 * by any page at all. Excluding it by id keeps the assertion on roles rather than on classes, which
 * is the rule the rest of this suite follows.
 */
function alerts(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

/**
 * Called inside a test body, never at module scope.
 *
 * `rlsEnv` throws on a partial credential set, and the e2e job gives two of the three placeholder
 * values by design - so at module scope this is a collection error and every project goes red on a
 * fork. Card 0031 paid for that lesson once. The auto fixture guard has already skipped by the time
 * any of this runs.
 */
function admin(): SupabaseClient {
  const env = rlsEnv()!;
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A throwaway account, so nothing here can change a persona the other specs depend on. */
async function makeUser(db: SupabaseClient) {
  const email = `reset-${randomUUID().slice(0, 8)}@example.com`.toLowerCase();
  const password = `old-${randomUUID()}`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(error?.message ?? null, "could not create the throwaway account").toBeNull();
  return { id: data.user!.id, email, password };
}

/** The token the email would have carried. `generateLink` returns it rather than sending it. */
async function recoveryToken(db: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email });
  expect(error?.message ?? null, "could not generate a recovery link").toBeNull();
  const hash = data.properties?.hashed_token;
  expect(hash, "the recovery link carried no token hash").toBeTruthy();
  return hash!;
}

test.describe("the reset link", () => {
  test("is offered from the login page", async ({ browser }) => {
    const context = await anonContext(browser);
    const page = await context.newPage();
    try {
      await page.goto("/login");
      await page.getByRole("link", { name: /forgot your password/i }).click();
      await page.waitForURL(/\/login\/reset/);

      await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();

      /*
       * The rule the login page is already asserted against, restated here because this is a new
       * public page and it is the one place a "create an account" link would look natural.
       */
      await expect(
        page.getByRole("link", { name: /sign ?up|create.*account|register/i }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("says the same thing for an address that has no account", async ({ browser }) => {
    /*
     * The direction of the leak that matters. With self-signup disabled the set of accounts is the
     * owner's staff list, so the danger is an *unknown* address behaving differently from a known
     * one - an error, a different message, a visibly faster response. A known address failing
     * would be a bug and not a disclosure.
     *
     * Asserted with an address that certainly has none, which also means this test sends no mail:
     * doing the symmetrical half would consume the built-in mailer's hourly allowance on every run,
     * and that allowance is what a locked-out staff member needs.
     */
    const context = await anonContext(browser);
    const page = await context.newPage();
    try {
      await page.goto("/login/reset");
      await page.getByLabel(/email/i).fill(`nobody-${randomUUID().slice(0, 8)}@example.com`);
      await page.getByRole("button", { name: /send the link/i }).click();

      const sent = page.getByRole("status");
      await expect(sent).toContainText(/check your email/i);
      await expect(sent).toContainText(/if that address has an account/i);
      // Not an error, and not a hint that the address is unknown.
      await expect(alerts(page)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("sets a new password that then works, and retires the old one", async ({ browser }) => {
    const db = admin();
    const user = await makeUser(db);
    const fresh = `new-${randomUUID()}`;

    try {
      const token = await recoveryToken(db, user.email);

      // ---- the browser that follows the link
      const first = await anonContext(browser);
      const page = await first.newPage();
      try {
        await page.goto(`/auth/confirm?token_hash=${token}&type=recovery&next=/account/password`);
        await page.waitForURL(/\/account\/password/);

        // The address, so somebody holding two accounts knows which one they are changing.
        await expect(page.getByRole("heading", { name: /set a new password/i })).toBeVisible();
        await expect(page.getByText(user.email)).toBeVisible();

        // The confirmation field is a real check, so prove it refuses before proving it accepts.
        await page.getByLabel(/^new password$/i).fill(fresh);
        await page.getByLabel(/again/i).fill(`${fresh}-typo`);
        await page.getByRole("button", { name: /set password/i }).click();
        await expect(alerts(page)).toContainText(/do not match/i);

        /*
         * And the refusal kept what was typed, which is the half that was broken. React resets an
         * uncontrolled form once its action completes, so both boxes used to empty on a refusal -
         * fixing the confirmation then submitted a blank password, native validation swallowed the
         * click, and the stale error stayed on screen looking like nothing had happened.
         */
        await expect(page.getByLabel(/^new password$/i)).toHaveValue(fresh);

        await page.getByLabel(/again/i).fill(fresh);
        await page.getByRole("button", { name: /set password/i }).click();

        /*
         * No alert left, checked before the panel is waited for - and `toHaveText([])` rather than
         * `toHaveCount(0)` because it prints what was on screen instead of a number.
         *
         * That is not a stylistic preference. This assertion is what diagnosed the form: waiting
         * only for the success panel turned the failure into "element not found" after thirty
         * seconds, while reading the alert said `Those two do not match.` - the error from the
         * PREVIOUS submit, still there, which is how the uncontrolled-form reset was found.
         */
        await expect(alerts(page), "the form refused the new password").toHaveText([]);
        await expect(page.getByRole("status")).toContainText(/password set/i);
      } finally {
        await first.close();
      }

      // ---- a browser that was never part of the reset
      const second = await anonContext(browser);
      const signIn = await second.newPage();
      try {
        await signIn.goto("/login");
        await signIn.getByLabel(/email/i).fill(user.email);
        await signIn.getByLabel(/password/i).fill(user.password);
        await signIn.getByRole("button", { name: /sign in/i }).click();
        /*
         * The old password, refused. Asserted before the new one is tried, because a reset that
         * quietly leaves the previous password working is the failure nobody would notice: the
         * happy path would pass and the account would have two keys.
         */
        await expect(alerts(signIn)).toContainText(/do not match an account/i);

        /*
         * And the refusal kept the address. Asserted here rather than in a login spec of its own
         * because signing in twice needs a real account, and this is the only spec that makes one.
         *
         * It is the same React form reset as the page before: a refused sign-in used to clear the
         * email as well as the password, so this test failed with the new password typed into a form
         * whose address field was empty - reported as a thirty-second timeout on a login page that
         * looked, in the snapshot, exactly like somebody had got their password wrong.
         */
        await expect(signIn.getByLabel(/email/i)).toHaveValue(user.email);

        await signIn.getByLabel(/password/i).fill(fresh);
        await signIn.getByRole("button", { name: /sign in/i }).click();
        await signIn.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
      } finally {
        await second.close();
      }
    } finally {
      // By recorded id, and the result is read - `deleteUser` resolves with its error rather than
      // throwing, which this repository has now written down three times.
      const { error } = await db.auth.admin.deleteUser(user.id);
      expect(error?.message ?? null, "the throwaway account was left behind").toBeNull();
    }
  });

  test("refuses a token that is not a recovery token", async ({ browser }) => {
    /*
     * `/auth/confirm` accepts one word for `type`, and this is why. `verifyOtp` will honour several,
     * so passing the query string through would make this route a general way to turn an emailed
     * token into a session - `signup` included, on a system whose first design decision is that
     * nobody signs themselves up. The token here is genuine; only the type is wrong.
     */
    const db = admin();
    const user = await makeUser(db);

    try {
      const token = await recoveryToken(db, user.email);
      const context = await anonContext(browser);
      const page = await context.newPage();
      try {
        await page.goto(`/auth/confirm?token_hash=${token}&type=signup&next=/account/password`);
        await page.waitForURL(/\/login\/reset/);
        await expect(alerts(page)).toContainText(/expired or had already been used/i);

        // And nobody was signed in on the way past. Anchored on a redirect to /login rather than on
        // the absence of something, so it cannot pass for the wrong reason.
        await page.goto("/");
        await expect(page).toHaveURL(/\/login/);
      } finally {
        await context.close();
      }
    } finally {
      const { error } = await db.auth.admin.deleteUser(user.id);
      expect(error?.message ?? null, "the throwaway account was left behind").toBeNull();
    }
  });

  test("sends a spent or invented link back to ask for another", async ({ browser }) => {
    const context = await anonContext(browser);
    const page = await context.newPage();
    try {
      await page.goto(`/auth/confirm?token_hash=${randomUUID()}&type=recovery&next=/`);
      await page.waitForURL(/\/login\/reset/);
      await expect(alerts(page)).toContainText(/expired or had already been used/i);

      await page.goto("/");
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await context.close();
    }
  });

  test("will not carry a signed-in user off to another origin", async ({ browser, baseURL }) => {
    /*
     * The open redirect. `next` arrives in a URL anybody can compose and the redirect happens with
     * a session freshly attached, so an unchecked value hands a signed-in user to another site.
     * `//example.com` is the case a `startsWith("/")` test alone lets through, which is why the
     * route makes both checks and why this asserts the scheme-relative form specifically.
     */
    const db = admin();
    const user = await makeUser(db);

    try {
      const token = await recoveryToken(db, user.email);
      const context = await anonContext(browser);
      const page = await context.newPage();
      try {
        await page.goto(
          `/auth/confirm?token_hash=${token}&type=recovery&next=${encodeURIComponent("//example.com/")}`,
        );
        await page.waitForURL(/\/account\/password/);
        /*
         * Against the suite's own base URL, not against `page.url()` - comparing that value to
         * itself is an assertion that cannot fail, which is the defect this repository keeps
         * finding in its own guards. The host has to be ours and the path has to be the fallback.
         */
        expect(new URL(page.url()).host, "the reset must not leave this origin").toBe(
          new URL(baseURL!).host,
        );
        await expect(page.getByRole("heading", { name: /set a new password/i })).toBeVisible();
      } finally {
        await context.close();
      }
    } finally {
      const { error } = await db.auth.admin.deleteUser(user.id);
      expect(error?.message ?? null, "the throwaway account was left behind").toBeNull();
    }
  });
});
