import { expect, readManifest, test } from "./authed";

/**
 * The staff admin, in a browser, for the first time.
 *
 * Card 0031. Everything here was verified by typecheck, lint, 113 unit tests and 52 policy tests
 * before anything rendered it — and two of its defects were found by *measuring* the source: a
 * horizontal overflow at 390px, and a destructive confirm button at 1.92:1 in dark mode. Neither is
 * catchable by any gate this repository has, which is what these assertions are for.
 *
 * Deliberately not a click-through of the happy path. Creating accounts on every run costs real
 * rows in a real project, so the invite is exercised once, for the case that used to lose the
 * owner's typing; everything else asserts a property that a screenshot would not tell you.
 */

/*
 * Skipped, not failed, when the setup project had no credentials to create personas with - the same
 * rule `rlsEnv` carries, so a fork can run CI. Where this suite is SUPPOSED to run, the absence is
 * caught by the workflow refusing a partial credential set rather than by a green skip.
 */
test.skip(readManifest() === null, "needs the personas the auth setup project creates");

test.describe("the owner", () => {
  test.use({ persona: "owner" });

  test("reaches settings and sees the roster", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

    // Four grants exist in the fixture, so the roster is not empty - which is what makes the
    // "Couldn't load people" and "Nobody yet" branches distinguishable in the first place.
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
    await expect(page.getByText(/Nobody yet/)).toHaveCount(0);
    await expect(page.getByText(/Couldn't load people/)).toHaveCount(0);
  });

  test("does not scroll sideways at 390px", async ({ page }) => {
    /*
     * The failure this exists for: the roster row's action cluster was `flex-none flex-wrap`, and a
     * flex-none container's width is max-content - so it could neither wrap nor shrink, and the
     * chips plus two buttons measured 358px inside a 350px row. "Every screen works at 390px" is a
     * design rule that had nothing enforcing it on any screen behind the login.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      "the page must not be wider than the viewport",
    ).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test("keeps what was typed when an invite is refused", async ({ page, manifest }) => {
    /*
     * React calls `requestFormReset` before invoking a form action, unconditionally - so an
     * uncontrolled form empties itself even when the action returns an error. The owner would read
     * "somebody already has an account with that email" over four blank fields.
     *
     * Refused on purpose, with an address that certainly exists: the owner's own. Nothing is
     * created, so this costs no rows.
     */
    await page.goto("/settings");

    const taken = manifest.personas.owner.email;
    await page.getByLabel(/Email they will sign in with/i).fill(taken);
    await page.getByLabel(/^Name/i).fill("Ana Reyes");
    await page.getByRole("radio", { name: /Manager/ }).check();
    await page.getByLabel(/^Branch$/i).selectOption({ index: 1 });
    await page.getByRole("button", { name: /Create account and grant access/i }).click();

    await expect(page.getByRole("status")).toContainText(/already has an account/i);
    await expect(page.getByLabel(/Email they will sign in with/i)).toHaveValue(taken);
    await expect(page.getByLabel(/^Name/i)).toHaveValue("Ana Reyes");
    await expect(page.getByRole("radio", { name: /Manager/ })).toBeChecked();
  });

  test.describe("the remove dialog", () => {
    /** The first non-owner row, which is the only kind that carries the controls. */
    const openDialog = async (page: import("@playwright/test").Page) => {
      await page.goto("/settings");
      await page.getByRole("button", { name: "Remove" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      return dialog;
    };

    test("opens with focus on Cancel, and Escape closes it", async ({ page }) => {
      // Focus landing on the safe option is the whole reason Cancel comes first in the DOM.
      const dialog = await openDialog(page);
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
    });

    test("names the person and the branch rather than saying 'this item'", async ({ page }) => {
      const dialog = await openDialog(page);
      // The heading carries a name, and the body carries where the access is lost.
      await expect(dialog.getByRole("heading")).toContainText(/access\?$/);
      await expect(dialog).toContainText(/They lose access to/);
      await expect(dialog.getByRole("button", { name: "Remove access" })).toBeVisible();
    });

    // A plain loop, because Playwright has no `describe.each` - that is Vitest's, and this file
    // imports from `@playwright/test`.
    for (const { theme, stored } of [
      { theme: "light", stored: null },
      { theme: "dark", stored: "dark" },
    ] as const) {
      test(`the confirm button's label clears 4.5:1 in ${theme}`, async ({ page }) => {
        /*
         * The measured failure: `--destructive-strong` is a dark red in light mode and a LIGHT one
         * in dark, so `text-white` on it was 8.36:1 and then 1.92:1 - unreadable, on the primary
         * button of a destructive confirmation. `tests/palette.test.ts` cannot see this, because it
         * reads tokens out of `globals.css` rather than a token used as a fill in markup.
         *
         * Computed here rather than compared against a hex, so it holds if either token moves.
         */
        await page.goto("/settings");
        await page.evaluate((value) => {
          if (value) localStorage.setItem("theme", value);
          else localStorage.removeItem("theme");
        }, stored);
        await page.reload();

        await page.getByRole("button", { name: "Remove" }).first().click();
        const confirm = page.getByRole("button", { name: "Remove access" });
        await expect(confirm).toBeVisible();

        const ratio = await confirm.evaluate((el) => {
          const parse = (value: string) => {
            const [r, g, b] = value
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number);
            return [r, g, b].map((c) => {
              const s = c / 255;
              return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
            });
          };
          const lum = (value: string) => {
            const [r, g, b] = parse(value);
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const style = getComputedStyle(el);
          const [a, b] = [lum(style.color), lum(style.backgroundColor)].sort((x, y) => y - x);
          return (a + 0.05) / (b + 0.05);
        });

        expect(ratio, `the destructive label must be readable in ${theme}`).toBeGreaterThanOrEqual(
          4.5,
        );
      });
    }
  });

  test("offers no remove or password control on an owner row", async ({ page }) => {
    /*
     * Both actions refuse an owner - removal because nothing here can grant owner back, a new
     * password because that would be a takeover rather than a rescue. `lib/rbac.ts` opens by saying
     * a screen should not offer a button the database will refuse.
     *
     * The owner row is the one showing "Whole organisation", since an owner grant names no branch.
     */
    await page.goto("/settings");
    const ownerRow = page.getByRole("listitem").filter({ hasText: "Whole organisation" }).first();
    await expect(ownerRow).toBeVisible();
    await expect(ownerRow.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(ownerRow.getByRole("button", { name: "New password" })).toHaveCount(0);
  });
});

test.describe("a staff member", () => {
  test.use({ persona: "staffA" });

  test("is refused settings entirely", async ({ page }) => {
    /*
     * A 404 and not a 403, so "not yours" and "does not exist" look the same to somebody probing.
     * Asserted in a browser because `requireCapability` protecting the RENDER is exactly the claim
     * that a unit test on the guard cannot make.
     */
    const response = await page.goto("/settings");
    expect(response?.status(), "settings should not exist for staff").toBe(404);
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toHaveCount(0);
  });

  test("sees no Settings destination in the navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });
});
