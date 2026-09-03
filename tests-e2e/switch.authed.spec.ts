import { ACTIVE_BRANCH_COOKIE } from "../src/lib/cookies";

import { expect, test } from "./authed";

/**
 * The selected branch: named on the screen, kept across a reload, and worth nothing to RLS.
 *
 * Card 0004's two remaining criteria. The failure mode the card names is quiet - "a sale entered
 * against a stale selected branch is attributed to the wrong place, and nothing complains" - so
 * both halves are about a value that is *believed*: the screen has to say which branch it is on,
 * and the value that says so must not be able to become a permission.
 *
 * The cookie name is imported rather than typed out. A second copy here would fail in the
 * invisible direction: rename the cookie and the forgery below sets something nobody reads,
 * `loadScope` falls back to the persona's own branch, and the test asserting that a forged value
 * changes nothing passes because the forgery stopped working. `lib/cookies.ts` exists for that
 * reason and says so.
 */

test.describe("an owner, who has several branches", () => {
  test.use({ persona: "owner" });

  test("lands on a view that names the selected branch and its business", async ({
    page,
    manifest,
  }) => {
    /*
     * At 390 deliberately. The shell's top bar names the branch from sm up and is `hidden` below
     * it, so the phone - the platform the brief calls primary - is the width where an owner with
     * four branches could land on a screen that never said which one they were on. Asserting at
     * the desktop width would have passed before this criterion was built.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    /*
     * By region rather than by looking for the branch name anywhere on the page. The name is in
     * the branch list further down as well, so a body-text match would go green on a page that had
     * lost the statement entirely - which is precisely the state this criterion describes.
     */
    const selected = page.getByRole("region", { name: "Selected branch" });
    await expect(selected).toBeVisible();
    await expect(selected).toContainText(manifest.branchAName);
    await expect(selected).toContainText(manifest.laundryName);
  });

  test("keeps a switched branch across a reload and a navigation", async ({ page, manifest }) => {
    const selected = page.getByRole("region", { name: "Selected branch" });

    await page.goto("/");
    await expect(selected).toContainText(manifest.branchAName);

    /*
     * Through the switcher, not by writing the cookie. The action re-checks the branch against RLS
     * before it writes anything, and that path is the one a person actually takes.
     */
    await page.goto("/switch");
    await page.getByRole("button", { name: manifest.branchBName }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await expect(selected).toContainText(manifest.branchBName);

    // The criterion, literally: a refresh.
    await page.reload();
    await expect(selected).toContainText(manifest.branchBName);
    await expect(selected).not.toContainText(manifest.branchAName);

    /*
     * And a navigation away and back, because the two can differ: a value held in a client
     * component's state survives a client-side navigation and dies on a reload, and a value read
     * from the request survives both. This one is read from the request.
     */
    await page.goto(`/b/${manifest.branchA}`);
    await page.goto("/");
    await expect(selected).toContainText(manifest.branchBName);
  });

  test("gets their own branch back when the cookie names another organisation's", async ({
    page,
    context,
    manifest,
    baseURL,
  }) => {
    /*
     * The other half of criterion 2, and the reason it says "not by the UI": the cookie is the one
     * input to scope that a person can edit, and `otherBranchId` belongs to an organisation nobody
     * in the fixture holds any grant in. So this is the forgery that would matter.
     *
     * `httpOnly` cookies can be set through the context even though script cannot, which is what
     * makes this testable at all - and what makes the flag no defence on its own.
     */
    await context.addCookies([
      { name: ACTIVE_BRANCH_COOKIE, value: manifest.otherBranchId, url: baseURL! },
    ]);
    await page.goto("/");

    const selected = page.getByRole("region", { name: "Selected branch" });
    await expect(selected).toBeVisible();
    // Their own first branch, not a blank statement and not the forged one.
    await expect(selected).toContainText(manifest.branchAName);

    // And the branch itself is still not reachable by naming it, which is the thing the cookie
    // would have to have granted for any of this to matter.
    const response = await page.goto(`/b/${manifest.otherBranchId}`);
    expect(response?.status(), "another organisation's branch should not exist here").toBe(404);
  });
});

test.describe("a staff member, who has exactly one branch", () => {
  test.use({ persona: "staffA" });

  test("is not moved by a cookie naming the branch next door", async ({
    page,
    context,
    manifest,
    baseURL,
  }) => {
    /*
     * The sharper version of the forgery. `otherBranchId` is across a tenancy boundary and would be
     * refused by the coarsest possible policy; branch B is in the same organisation, under the same
     * business, and is where the colleague this person must not see works. A policy that filtered by
     * organisation rather than by grant would let this one through.
     */
    await context.addCookies([
      { name: ACTIVE_BRANCH_COOKIE, value: manifest.branchB, url: baseURL! },
    ]);

    /*
     * One branch, so the landing page sends them straight to it - and WHICH one it sends them to is
     * the assertion. A stale or forged selection here is the card's failure mode in its most direct
     * form: the screen a sale would be entered on.
     */
    await page.goto("/");
    await page.waitForURL(/\/b\//);
    expect(page.url(), "the cookie must not decide which branch a staff member opens").toContain(
      manifest.branchA,
    );
    expect(page.url()).not.toContain(manifest.branchB);

    const response = await page.goto(`/b/${manifest.branchB}`);
    expect(response?.status(), "a colleague's branch should not exist for staff").toBe(404);
  });
});
