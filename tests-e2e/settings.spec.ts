import { rlsFullyConfigured } from "../tests-rls/harness";

import { expect, readManifest, stateExists, test } from "./authed";

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
 * The guard is a `beforeEach` hook and NOT a file-level `test.skip(...)`, which is where the first
 * run of this suite went.
 *
 * A file-scope modifier is evaluated when the file is LOADED, and Playwright loads every test file
 * to collect tests before it runs any project - including the setup project this one depends on. So
 * the manifest was read before it had been written, all ten tests were marked skipped during
 * collection, and CI reported `32 passed, 12 skipped` with a green tick: the setup created five auth
 * users, signed all five in, the teardown deleted them again, and nothing in between ever ran.
 * Verified with a two-project experiment - identical condition, identical dependency, the file-level
 * copy skipped and the hook copy passed.
 *
 * A hook is evaluated per test, after the dependency has finished, which is the only time the
 * question has an answer.
 */
test.beforeEach(({ persona }) => {
  /*
   * The credentials decide first, and nothing else does.
   *
   * Keyed on all three variables being present rather than on `rlsEnv`, which throws on a partial
   * set - and the e2e job's placeholders make that set partial on a fork by design.
   *
   * Asking the credentials BEFORE the manifest also settles a case the previous order got wrong.
   * `tests-e2e/.auth` survives any run where the credentials are absent, because both the setup and
   * the teardown skip before touching it - so on a machine that once had them, a stale manifest
   * would satisfy the guard and these ten tests would run against accounts that no longer exist.
   * Nine would fail confusingly and one would pass, which is this commit's own defect inverted.
   */
  if (!rlsFullyConfigured()) {
    test.skip(true, "needs the personas the auth setup project creates");
    return;
  }

  /*
   * From here the setup project must have produced both artefacts, so their absence is a failure
   * and must not go green - the whole lesson of the run described above.
   *
   * Both, not just the manifest. They are written at different times: the manifest before any
   * sign-in, each `<persona>.json` after that persona's. So a present manifest is not evidence
   * that THIS test's browser has a session, and `authed.ts` falls back to no session rather than
   * throwing when the state file is missing.
   */
  if (readManifest() === null) {
    throw new Error(
      "The Supabase credentials are configured, so the auth setup project should have written " +
        "tests-e2e/.auth/fixture.json. It is absent, which means the setup did not run or did " +
        "not finish. These tests must not skip to green where they are supposed to run.",
    );
  }
  if (!stateExists(persona)) {
    throw new Error(
      `The fixture exists but tests-e2e/.auth/${persona}.json does not, so this test would run ` +
        "with no session and assert against the login page instead.",
    );
  }
});

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
         *
         * The first version of this measurement was wrong in the worst available way. It read
         * `getComputedStyle().color`, pulled the first three numbers out with a regex and treated
         * them as 0-255 sRGB - and Chrome serialises a computed `oklch()` colour as
         * `oklab(0.444 0.158 0.076)`. Every channel came out below 1, every luminance collapsed to
         * roughly zero, and both themes reported a ratio near 1.0: light mode "failed" at 1.09,
         * where `#991b1b` under `#fef2f2` is about 8:1. It surfaced only because the number was
         * absurd. Had the nonsense landed above 4.5 it would have passed forever, measuring nothing.
         *
         * So the parsing is handed to the browser: a 1x1 canvas normalises ANY colour syntax to
         * sRGB bytes, a sentinel catches a value it will not parse rather than silently keeping the
         * previous fill, and the whole thing self-checks against black-on-white being 21:1.
         */
        await page.goto("/settings");
        await page.evaluate((value) => {
          if (value) localStorage.setItem("theme", value);
          else localStorage.removeItem("theme");
        }, stored);
        await page.reload();

        // Assert the theme actually took. Otherwise the dark case quietly measures the light one,
        // and the more dangerous of the two tokens never gets looked at.
        expect(
          await page.evaluate(() => document.documentElement.classList.contains("dark")),
          `the ${theme} theme should be applied to the document`,
        ).toBe(theme === "dark");

        await page.getByRole("button", { name: "Remove" }).first().click();
        const confirm = page.getByRole("button", { name: "Remove access" });
        await expect(confirm).toBeVisible();

        const ratio = await confirm.evaluate((el) => {
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext("2d")!;

          /** Any CSS colour syntax in, sRGB bytes out: oklab, oklch, rgb, hex or a keyword. */
          const bytes = (value: string): number[] => {
            const sentinel = "#123456";
            ctx.fillStyle = sentinel;
            ctx.fillStyle = value;
            if (ctx.fillStyle === sentinel && value !== sentinel) {
              throw new Error(`the browser would not parse ${value} as a colour`);
            }
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data);
          };

          const lum = ([r, g, b]: number[]) => {
            const [lr, lg, lb] = [r, g, b].map((c) => {
              const channel = c / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : Math.pow((channel + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
          };

          const contrast = (one: number, two: number) => {
            const [hi, lo] = [one, two].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
          };

          /*
           * A self-check, because the failure this replaces was a measurement that returned a
           * plausible-looking number instead of an error. If the arithmetic is right this is 21.
           */
          const known = contrast(lum(bytes("#ffffff")), lum(bytes("#000000")));
          if (Math.abs(known - 21) > 0.01) {
            throw new Error(`the contrast maths is broken: white on black measured ${known}`);
          }

          /*
           * The button's own background may be transparent, and treating that as black is exactly
           * how a bogus ratio gets manufactured. Walk up until something actually paints.
           */
          let node: Element | null = el;
          let background: number[] | null = null;
          while (node) {
            const painted = bytes(getComputedStyle(node).backgroundColor);
            if (painted[3] === 255) {
              background = painted;
              break;
            }
            node = node.parentElement;
          }
          if (!background) throw new Error("nothing above the button paints an opaque background");

          return contrast(lum(bytes(getComputedStyle(el).color)), lum(background));
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
