import { expect, test } from "@playwright/test";

/**
 * The pipeline, not the product.
 *
 * M0 exists to prove that a page renders, the build succeeds and the deploy works before
 * anything is built on top of it. This is the first half of that: if it fails, nothing later
 * in TASKS.md is worth starting.
 */
test("the app serves a page", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.locator("body")).toBeVisible();
});
