import { contrastOf, useTheme } from "./contrast";
import { expect, test } from "./authed";

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

    // Positively, not just by the absence of the two empty states: somebody is actually listed.
    await expect(
      page.getByRole("listitem").filter({ hasText: "Whole organisation" }).first(),
    ).toBeVisible();
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

    /*
     * Scoped to the form, because `getByLabel(/^Name/i)` matched THREE fields on this page: the
     * invite, "Add a business" and "Add a branch" all ask for a name. That is what the first real
     * run of this test found, and the fix belongs partly in the app - a page carrying three unnamed
     * forms is as ambiguous to a screen reader as it was to the locator, so each one now has an
     * accessible name and this addresses the one it means - by the words on the screen, which
     * is why the invite form points at its own visible heading rather than carrying a label
     * only a screen reader ever hears.
     */
    const form = page.getByRole("form", { name: "Add someone" });

    const taken = manifest.personas.owner.email;
    await form.getByLabel(/Email they will sign in with/i).fill(taken);
    await form.getByLabel(/^Name/i).fill("Ana Reyes");
    await form.getByRole("radio", { name: /Manager/ }).check();
    await form.getByLabel(/^Branch$/i).selectOption({ index: 1 });
    await form.getByRole("button", { name: /Create account and grant access/i }).click();

    await expect(form.getByRole("status")).toContainText(/already has an account/i);
    await expect(form.getByLabel(/Email they will sign in with/i)).toHaveValue(taken);
    await expect(form.getByLabel(/^Name/i)).toHaveValue("Ana Reyes");
    await expect(form.getByRole("radio", { name: /Manager/ })).toBeChecked();
  });

  test.describe("the remove dialog", () => {
    /** The first non-owner row, which is the only kind that carries the controls. */
    const openDialog = async (page: import("@playwright/test").Page) => {
      await page.goto("/settings");
      await page
        .getByRole("button", { name: /^Remove .*access to / })
        .first()
        .click();
      // By name, for the same reason as the grant dialog: there are two per row and both are named.
      const dialog = page.getByRole("dialog", { name: /^Remove .*access\?$/ });
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
    for (const theme of ["light", "dark"] as const) {
      test(`the confirm button's label clears 4.5:1 in ${theme}`, async ({ page }) => {
        /*
         * The measured failure: `--destructive-strong` is a dark red in light mode and a LIGHT one
         * in dark, so `text-white` on it was 8.36:1 and then 1.92:1 - unreadable, on the primary
         * button of a destructive confirmation. `tests/palette.test.ts` cannot see this, because it
         * reads tokens out of `globals.css` rather than a token used as a fill in markup.
         *
         * Measured rather than compared against a hex, so it holds if either token moves. The
         * measurement lives in `contrast.ts`, along with the account of how it was wrong the first
         * time and what the canvas is for.
         */
        await page.goto("/settings");
        await useTheme(page, theme);

        await page
          .getByRole("button", { name: /^Remove .*access to / })
          .first()
          .click();
        const confirm = page.getByRole("button", { name: "Remove access" });
        await expect(confirm).toBeVisible();

        const ratio = await contrastOf(confirm);

        expect(ratio, `the destructive label must be readable in ${theme}`).toBeGreaterThanOrEqual(
          4.5,
        );
      });
    }
  });

  test.describe("the grant-owner dialog", () => {
    /*
     * Card 0034. Opened but never confirmed, deliberately - the same rule the rest of this file
     * follows. The fixture organisation has one owner and one signed-in owner persona, so actually
     * granting owner mid-run would change what every other assertion in this file means, and it
     * would be a real owner row in a real project.
     *
     * What is asserted is what a screenshot would not tell you: where focus lands, what the copy
     * commits to, and that the label is readable in both themes.
     */
    const openGrantDialog = async (page: import("@playwright/test").Page) => {
      await page.goto("/settings");
      await page
        .getByRole("button", { name: /^Make .* an owner of / })
        .first()
        .click();
      /*
       * Found by the dialog's own accessible NAME, not by a button inside it.
       *
       * Two dialogs live in each roster row, and this used to disambiguate them by their confirm
       * button - which worked, and was the symptom of both `<dialog>` elements having no name at all.
       * They are `aria-labelledby` their headings now, so this locator asserts that naming exists as
       * a side effect of finding the thing.
       */
      const dialog = page.getByRole("dialog", { name: /an owner of/ });
      await expect(dialog).toBeVisible();
      return dialog;
    };

    test("is offered on a manager or staff row", async ({ page }) => {
      // Positively, before anything else asserts what the dialog says: `controlsFor` offers this once
      // per person, and if it offered it nowhere the tests below would pass by never opening.
      await page.goto("/settings");
      // Matched on the accessible name, which names the person and the organisation - the visible
      // label is just the verb.
      await expect(
        page.getByRole("button", { name: /^Make .* an owner of / }).first(),
      ).toBeVisible();
    });

    test("opens with focus on Cancel, and Escape closes it", async ({ page }) => {
      // Handing over the organisation is the last place a dialog should open with the confirm button
      // focused. Cancel comes first in the DOM, which is what puts focus there.
      const dialog = await openGrantDialog(page);
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
    });

    test("says what is handed over, and that it points back at the granter", async ({ page }) => {
      /*
       * Criterion 2, asserted as three separate claims because they are three separate jobs and a
       * single `toContainText` over the whole dialog would pass if any one of them were deleted.
       */
      const dialog = await openGrantDialog(page);

      // What an owner can do.
      await expect(dialog).toContainText(/sees every business, branch and peso/i);
      // That it includes the person granting it.
      await expect(dialog).toContainText(/can remove your access/i);
      // That it cannot be undone alone.
      await expect(dialog).toContainText(/cannot take this back on your own/i);
      // The verb, not "OK".
      await expect(dialog.getByRole("button", { name: "Make them an owner" })).toBeVisible();
    });

    for (const theme of ["light", "dark"] as const) {
      test(`the confirm button's label clears 4.5:1 in ${theme}`, async ({ page }) => {
        /*
         * The same inverting token pair as the remove dialog, and the same reason it is measured
         * rather than eyeballed: `--destructive-strong` is dark in light mode and light in dark, so a
         * fixed foreground is readable in exactly one of them.
         */
        await page.goto("/settings");
        await useTheme(page, theme);

        await page
          .getByRole("button", { name: /^Make .* an owner of / })
          .first()
          .click();
        const confirm = page.getByRole("button", { name: "Make them an owner" });
        await expect(confirm).toBeVisible();

        expect(
          await contrastOf(confirm),
          `the grant confirmation must be readable in ${theme}`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }

    test("every control in a roster row is at least 44px tall", async ({ page }) => {
      /*
       * Measured on the rendered element, which nothing in this repository did before: the 46px
       * `--pill-h` token is asserted by a unit test, and a token is not a control. A third button in
       * this row is exactly the change that would tempt somebody to shrink them.
       */
      await page.goto("/settings");
      /*
       * Found by the presence of a control, not by a chip.
       *
       * The first version anchored on "Not signed in yet", which does not exist here: the setup
       * project signs every persona in, so no row carries that chip - and this same commit stopped
       * offering "New password" to anybody who has signed in, so the row is thinner than the mental
       * model behind that locator. A row that HAS a Remove button is what this test is about.
       */
      const row = page
        .getByRole("listitem")
        .filter({ has: page.getByRole("button", { name: /^Remove .*access to / }) })
        .first();
      await expect(row).toBeVisible();

      const buttons = row.getByRole("button");
      const count = await buttons.count();
      expect(count, "the row should carry controls to measure").toBeGreaterThan(0);

      for (let index = 0; index < count; index += 1) {
        const box = await buttons.nth(index).boundingBox();
        const name = await buttons.nth(index).textContent();
        expect(
          box?.height ?? 0,
          `"${name?.trim()}" is below the 44px hit area`,
        ).toBeGreaterThanOrEqual(44);
      }
    });
  });

  test("offers no remove or password control on the only owner's row", async ({ page }) => {
    /*
     * Still true, and true for a DIFFERENT reason since card 0034 - which is worth stating, because a
     * test that keeps passing for a reason nobody chose is not evidence of anything.
     *
     * It used to be "an owner row never has controls", because nothing in the app could grant owner
     * back. Now removal is offered on an owner row whenever another owner remains. The fixture has
     * exactly one owner, so `controlsFor` withholds it here on the count - and a new password is
     * still withheld because `may_reissue_password` refuses anybody who is an owner anywhere.
     *
     * The owner row is the one showing "Whole organisation", since an owner grant names no branch.
     */
    await page.goto("/settings");
    const ownerRow = page.getByRole("listitem").filter({ hasText: "Whole organisation" }).first();
    await expect(ownerRow).toBeVisible();
    await expect(ownerRow.getByRole("button", { name: /^Remove .*access to / })).toHaveCount(0);
    await expect(ownerRow.getByRole("button", { name: /^Issue a new password/ })).toHaveCount(0);
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
    /*
     * Anchored on a destination that SHOULD be there, because a purely negative assertion passes
     * for all the wrong reasons: with no session the middleware redirects to /login, which has no
     * Settings link either - and it would also pass on a 500, on an empty body, and the day the
     * link gets renamed. "Today" is in the rail for every role, so seeing it proves this is the
     * signed-in shell before the absence of Settings is allowed to mean anything.
     */
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });
});
