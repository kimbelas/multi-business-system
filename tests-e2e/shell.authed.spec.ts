import { expect, test } from "./authed";

/**
 * The shell, signed in: what the header says it is.
 *
 * Card 0035. `Scope.orgId` was `memberships[0]?.org_id` from a query with no `ORDER BY`, and
 * `orgName` was the name of whatever that returned — so for anybody holding grants in two
 * organisations the header named one of them by accident, and which one could change with a plan
 * change rather than with anything a user did.
 *
 * It is now `activeOrgId`, taken from the active business, and `null` when there is no single answer
 * rather than a guess. `tests/rbac.test.ts` pins that rule exhaustively; what a unit test cannot say
 * is whether the value reaches the screen. The specific regression that rule could cause is a header
 * reading "Bizdesk" for somebody who does have an organisation — a null that fires when it should
 * not — and no other check in this repository would notice.
 */

test.describe("the header", () => {
  test.use({ persona: "owner" });

  test("names the organisation, not the product", async ({ page, manifest }) => {
    await page.goto("/");

    /*
     * The rail's first line is the organisation name. Asserted against the fixture's own name rather
     * than "is not Bizdesk", because a header showing the WRONG organisation would pass that weaker
     * form - and naming somebody else's tenancy is the failure worth catching, not a missing string.
     */
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    await expect(nav).toContainText(manifest.orgName);

    // And not the fallback, which is what a null `activeOrgId` renders. Stated separately because
    // the assertion above would also pass if the fixture were ever named "Bizdesk".
    await expect(nav).not.toContainText("Bizdesk");
  });

  test("says the same thing on a second load", async ({ page, manifest }) => {
    /*
     * The coin-flip property, directly. The old value came from an unordered query, so "stable
     * across two loads" is exactly what it could not promise - and a header that renames itself on
     * refresh is the symptom a user would report.
     */
    await page.goto("/");
    const first = await page.getByRole("navigation", { name: "Main" }).textContent();

    await page.reload();
    const second = await page.getByRole("navigation", { name: "Main" }).textContent();

    expect(second, "the header must not change on a reload").toBe(first);
    expect(first).toContain(manifest.orgName);
  });
});
