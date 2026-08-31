import { expect, test } from "@playwright/test";

/**
 * The four-tap rule, and the responsive rules, asked of a real browser.
 *
 * This exists because of what it found on the way in. `next dev` served every page with HTTP
 * 200 and returned 403 for `/_next/static/chunks/*.js`, so nothing hydrated - Next 16 blocks
 * cross-origin dev resources and treats `127.0.0.1` as a different host from `localhost`,
 * which is the address this whole suite uses. `smoke.spec.ts` passed throughout, because a
 * status code and a visible body are true of a page with no JavaScript running.
 *
 * So the first assertion here is not about the design at all: it is that tapping the keypad
 * changes the number. Everything else is downstream of that being true.
 */

const WIDTHS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const screen = '[data-testid="counter-screen"]';

for (const { name, width, height } of WIDTHS) {
  test.describe(`${name} ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test("records a sale in four taps", async ({ page }) => {
      await page.goto("/preview");
      const amount = page.locator(`${screen} output`);
      await expect(amount).toHaveText("₱0.00");

      // Three digits and Record sale. If the count here ever needs to go up, the rule the
      // whole app is designed around has been broken and this is where it says so.
      for (const digit of ["1", "8", "0"]) {
        await page.locator(`${screen} button[aria-label="${digit}"]`).click();
      }
      await expect(amount).toHaveText("₱180.00");

      const submit = page.locator(`${screen} button[type="submit"]`);
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(amount).toHaveText("₱0.00");
    });

    test("refuses a zero sale", async ({ page }) => {
      await page.goto("/preview");
      await expect(page.locator(`${screen} button[type="submit"]`)).toBeDisabled();
      await page.locator(`${screen} button[aria-label="0"]`).click();
      await expect(page.locator(`${screen} button[type="submit"]`)).toBeDisabled();
    });

    test("keeps every control at or above its floor", async ({ page }) => {
      await page.goto("/preview");
      // Rule 4: nothing shrinks on a bigger screen. Measured, not asserted from the source.
      const key = page.locator(`${screen} button[aria-label="1"]`);
      const pill = page.locator(`${screen} [role="radio"]`).first();
      const submit = page.locator(`${screen} button[type="submit"]`);

      expect((await key.boundingBox())!.height).toBeGreaterThanOrEqual(58);
      expect((await pill.boundingBox())!.height).toBeGreaterThanOrEqual(46);
      expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(60);
    });

    test("caps the keypad and keeps commit underneath it", async ({ page }) => {
      await page.goto("/preview");
      const pad = page.locator(`${screen} .grid.grid-cols-3`);
      const submit = page.locator(`${screen} button[type="submit"]`);

      const padBox = (await pad.boundingBox())!;
      const submitBox = (await submit.boundingBox())!;

      // Rule 1. The cap is the whole responsive idea, so it is measured at every width rather
      // than trusted at the widest one.
      expect(padBox.width).toBeLessThanOrEqual(440);
      // Rule 3. Never promoted to a toolbar, however much room there is.
      expect(submitBox.y).toBeGreaterThan(padBox.y + padBox.height);
    });

    test("never scrolls sideways", async ({ page }) => {
      await page.goto("/preview");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("arrangement", () => {
  test("the rail appears only from 1024px", async ({ page }) => {
    // Rule 6: two breakpoints, three arrangements. Asserted as the visibility of the one
    // element that distinguishes the third from the second.
    const rail = page.locator('nav[aria-label="Main"]');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/preview");
    await expect(rail.first()).toBeHidden();

    await page.setViewportSize({ width: 834, height: 1112 });
    await expect(rail.first()).toBeHidden();

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(rail.first()).toBeVisible();
  });

  test("the by-business table appears only from 640px", async ({ page }) => {
    const table = page.locator("table");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/preview");
    // A five-column table at 390px is a horizontal scroll nobody performs; the share bar
    // carries the same three figures instead.
    await expect(table.first()).toBeHidden();

    await page.setViewportSize({ width: 834, height: 1112 });
    await expect(table.first()).toBeVisible();
  });
});

test.describe("graphs", () => {
  test("the week chart is stacked by business, in the business colours", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/preview");

    const segments = page.locator('[data-testid="dashboard"] section:has-text("This week") div[style*="--chart-"]');
    // Seven days, three businesses each. A single-series chart would have seven.
    await expect(segments).toHaveCount(21);

    const colours = await segments.evaluateAll((nodes) =>
      [...new Set(nodes.map((n) => getComputedStyle(n).backgroundColor))].length,
    );
    // Three resolved colours, not one. This is what fails if the chart scale is quietly
    // returned to shadcn's five greys.
    expect(colours).toBe(3);
  });

  /*
   * Both lists exist in the DOM at every width - one is `sm:hidden`, the other `hidden sm:flex`
   * - so a locator that does not name one of them sums the percentages twice and reads 200.
   * They are addressed by test id for that reason, and both are checked: the same numbers are
   * rendered from the same call in two places, and either could be the one that drifts.
   */
  for (const [id, width] of [
    ["share-figures", 390],
    ["share-legend", 1440],
  ] as const) {
    test(`the share percentages in ${id} add up to 100`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/preview");

      const texts = await page.locator(`[data-testid="${id}"] li span:last-child`).allInnerTexts();
      expect(texts.length).toBe(3);
      const total = texts.map((t) => Number(t.replace("%", ""))).reduce((a, b) => a + b, 0);
      // Rounding each share on its own gives 99 here, and the bar would have a gap in it.
      expect(total).toBe(100);
    });
  }
});
