import { expect, test } from "@playwright/test";

/**
 * The things that must be true of a build anyone can reach.
 *
 * Every other spec in here drives `/preview`, which is development-only by design, so pointing
 * them at a deployed Worker would fail twenty-four tests for the correct reason and tell you
 * nothing. This file is the part that runs anywhere:
 *
 *   pnpm test:e2e                                     against the local dev server
 *   PLAYWRIGHT_BASE_URL=https://... pnpm test:e2e:deployed
 *
 * When it is pointed at a deployed build it also asserts the two guards that only mean anything
 * there - that the design preview is gone, and that an unauthenticated request cannot get past
 * the middleware.
 */

const DEPLOYED = !!process.env.PLAYWRIGHT_BASE_URL;

test("an unauthenticated request lands on the login page", async ({ page }) => {
  // The middleware gate, end to end. It is the only thing between the open internet and every
  // screen in the app, and it is one `isPublic` expression away from being wrong.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("the login page asks for an email and a password, and offers no signup", async ({ page }) => {
  await page.goto("/login");

  // Found by role rather than by class, so a restyle does not break it and a missing label does.
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();

  // No self-signup is a decision in the brief, not an omission: the owner invites staff
  // server-side. A "create an account" link appearing here would be a real regression.
  await expect(page.getByRole("link", { name: /sign ?up|create.*account|register/i })).toHaveCount(
    0,
  );
});

test("the login page renders without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/login", { waitUntil: "networkidle" });
  expect(errors).toEqual([]);
});

test("the redirect remembers where the request was going", async ({ page }) => {
  // Signing in should land where they were headed rather than at a generic home, and the only
  // thing carrying that is the `next` parameter the middleware sets.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/[?&]next=%2Fdashboard/);
});

test.describe("only meaningful on a deployed build", () => {
  test.skip(!DEPLOYED, "no PLAYWRIGHT_BASE_URL, so this is the dev server");

  test("the design preview is not reachable", async ({ page }) => {
    /*
     * Two guards, and this asserts the pair rather than either.
     *
     * `notFound()` in the route stops it rendering when NODE_ENV is production, and the
     * middleware only adds it to `isPublic` outside production. If the first were removed the
     * page would render for anyone; if the second were removed it would redirect to login. So a
     * 404 or a redirect to login are both acceptable - what is not is a page of invented pesos
     * on a URL anyone can reach.
     */
    const response = await page.goto("/preview");
    const status = response?.status() ?? 0;
    const url = page.url();

    const gone = status === 404;
    const gated = /\/login/.test(url);
    expect(gone || gated, `expected 404 or a login redirect, got ${status} at ${url}`).toBe(true);

    if (gone) {
      await expect(page.getByText(/design preview/i)).toHaveCount(0);
    }
  });

  test("serves over https", async ({ page }) => {
    await page.goto("/login");
    expect(new URL(page.url()).protocol).toBe("https:");
  });
});
