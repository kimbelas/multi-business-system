import { createClient } from "@supabase/supabase-js";

import { rlsEnv } from "../tests-rls/harness";
import { expect, test } from "./authed";

/**
 * The counter, with a real session and a real branch — card 0005.
 *
 * Two of the four criteria can be answered here. The other two need a person and a phone: four taps
 * counted by somebody who is not the developer, and thirty seconds on a mid-range Android. Those are
 * deliberately not simulated, because a simulation of them would be a number that reassures rather
 * than one that is true.
 *
 * What this file answers is the one a person cannot check by looking: **the same sale submitted
 * twice is one transaction.** That is a claim about a database under a dropped connection, and the
 * only honest way to make it is to submit twice and then count the rows.
 */

/** Amounts unique to this file, so the counts below are about these tests and nothing else. */
const ONCE = "250";
const TWICE = "137";

/**
 * A service-role client, for counting and for cleaning up.
 *
 * Counting through the browser would mean trusting the screen to tell me what the database holds,
 * which is the thing under test. Cleaning up needs it for a different reason: `transactions` has no
 * delete policy at all — deliberately, it is an audit trail — so no session can remove these rows,
 * and the fixture cannot drop its branches while they exist.
 */
function admin() {
  const env = rlsEnv();
  if (!env) return null;
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe("recording a sale", () => {
  test.use({ persona: "staffA" });

  test.afterAll(async () => {
    const db = admin();
    if (!db) return;
    const { error } = await db.from("transactions").delete().in("amount", [ONCE, TWICE]);
    // Reported rather than swallowed: a leak here leaves rows in a real project and, worse, blocks
    // the fixture's own teardown, which then reports the branch it could not delete instead.
    expect(error, "the sale spec could not clean up after itself").toBeNull();
  });

  test("records it, and says who took it, where and when", async ({ page, manifest }) => {
    await page.goto(`/b/${manifest.branchA}/sell`);
    await page.getByTestId("counter-screen").waitFor();

    // The pad, not a text field. An amount is entered the way it is at a counter.
    for (const digit of ONCE.split("")) {
      await page.getByRole("button", { name: digit, exact: true }).click();
    }
    await page.getByRole("button", { name: /record/i }).click();

    const confirmation = page.getByTestId("sale-confirmation");
    await expect(confirmation).toBeVisible();

    // The three facts the card says a completed sale must show. Compared against the fixture's own
    // strings rather than rebuilt from a run id, because two wrong copies of a name agree perfectly.
    await expect(confirmation).toContainText("₱250.00");
    await expect(confirmation).toContainText(manifest.branchAName);

    // "When" renders in Asia/Manila wherever the browser thinks it is. Asserting the exact minute
    // would be asserting the clock; that a time is shown at all is the claim.
    await expect(confirmation.getByText(/\d{1,2}:\d{2}\s?(am|pm)/i)).toBeVisible();
  });

  test("counts one transaction when the same sale is submitted twice", async ({
    page,
    manifest,
  }) => {
    const db = admin();
    test.skip(!db, "needs the service-role key to count rows");

    await page.goto(`/b/${manifest.branchA}/sell`);
    await page.getByTestId("counter-screen").waitFor();
    for (const digit of TWICE.split("")) {
      await page.getByRole("button", { name: digit, exact: true }).click();
    }

    /*
     * Two submits, deliberately racing.
     *
     * `useTransition` disables the form between them most of the time, which is exactly why this
     * dispatches the event rather than clicking: the point is not that the UI guard works, it is
     * that the guard *failing* costs nothing. A double tap on a slow phone, a browser retry, a
     * back-then-forward — all arrive as a second POST carrying the same attempt id, and the
     * database is what refuses it.
     */
    const record = page.getByRole("button", { name: /record/i });
    await Promise.all([record.dispatchEvent("click"), record.dispatchEvent("click")]);

    await expect(page.getByTestId("sale-confirmation")).toContainText("₱137.00");

    // The assertion, read from the database rather than from the screen that just claimed it.
    const { data } = await db!
      .from("transactions")
      .select("id, amount, staff_id, branch_id")
      .eq("branch_id", manifest.branchA)
      .eq("amount", TWICE);

    // `toEqual` on the list rather than a count, so a failure prints the second row instead of the
    // number two. That difference is what identified a cause in seconds on 2026-09-03.
    expect(
      (data ?? []).map((row) => String(row.amount)),
      "a double submit produced two transactions",
    ).toEqual([TWICE]);

    // And the one row that exists is attributed to the person who was signed in, not to whoever
    // the form said. That is enforced by RLS; this is the assertion that it reached the row.
    expect((data ?? [])[0]?.staff_id).toBe(manifest.personas.staffA.userId);
  });
});
