import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level authorization, asserted at the guard.
 *
 * `lib/authz.ts` opens with `import "server-only"`, which throws when imported outside a server
 * component - so it is mocked away here. That is not a workaround to be embarrassed about: the same
 * boundary is why `activeRoleFor` sat untested inside `loadScope` long enough for the rail to
 * derive navigation from the wrong role. A rule that cannot be imported does not get asserted.
 *
 * `notFound` and `redirect` both throw in Next, which is how they interrupt a render. The mocks
 * throw tagged errors so a test can tell which one fired - the difference matters: a 404 is the
 * answer to "not yours", and a redirect is the answer to "not signed in".
 */

vi.mock("server-only", () => ({}));

const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (to: string) => {
    throw new Error(`${REDIRECT}:${to}`);
  },
}));

const loadScope = vi.fn();
vi.mock("@/lib/scope", () => ({ loadScope: () => loadScope() }));

const { requireCapability } = await import("@/lib/authz");

const BRANCH_A = "aaaaaaaa-0000-0000-0000-000000000001";
const BRANCH_B = "bbbbbbbb-0000-0000-0000-000000000002";

/** Only the fields the guard reads. */
function scope(over: {
  activeRole?: "staff" | "manager" | "owner";
  branches?: { id: string; role: "staff" | "manager" | "owner" }[];
}) {
  return {
    activeRole: over.activeRole ?? "staff",
    businesses: [
      {
        id: "biz",
        name: "Laundry",
        type: "laundry",
        branches: (over.branches ?? []).map((b) => ({
          id: b.id,
          name: b.id,
          isActive: true,
          role: b.role,
        })),
      },
    ],
  };
}

beforeEach(() => loadScope.mockReset());

describe("requireCapability", () => {
  it("sends an unauthenticated request to the login page", async () => {
    loadScope.mockResolvedValue(null);
    await expect(requireCapability("manageOrganisation")).rejects.toThrow(`${REDIRECT}:/login`);
  });

  it("refuses a staff member an owner-only screen", async () => {
    // The case that prompted this: somebody types the URL. Without the guard they get the screen,
    // its queries return nothing because RLS refuses them, and what they see is a broken page
    // rather than an answer.
    loadScope.mockResolvedValue(scope({ activeRole: "staff" }));
    await expect(requireCapability("manageOrganisation")).rejects.toThrow(NOT_FOUND);
  });

  it("refuses a manager an owner-only screen", async () => {
    // "That applies to all roles" - manager is the one that looks trusted enough to slip through.
    loadScope.mockResolvedValue(scope({ activeRole: "manager" }));
    await expect(requireCapability("manageOrganisation")).rejects.toThrow(NOT_FOUND);
    await expect(requireCapability("dashboard")).rejects.toThrow(NOT_FOUND);
  });

  it("lets an owner through", async () => {
    const s = scope({ activeRole: "owner" });
    loadScope.mockResolvedValue(s);
    await expect(requireCapability("manageOrganisation")).resolves.toBe(s);
  });

  it("refuses staff a manager-only screen, and allows the manager", async () => {
    loadScope.mockResolvedValue(scope({ activeRole: "staff" }));
    await expect(requireCapability("exportCsv")).rejects.toThrow(NOT_FOUND);

    const s = scope({ activeRole: "manager" });
    loadScope.mockResolvedValue(s);
    await expect(requireCapability("exportCsv")).resolves.toBe(s);
  });

  it("checks the role at the named branch, not the highest one held", async () => {
    /*
     * The `navFor(scope.role)` bug one layer up, and the reason `branchId` is a parameter rather
     * than something inferred. This person is a manager somewhere, which must not buy them a
     * manager screen at the branch where they are staff.
     */
    loadScope.mockResolvedValue(
      scope({
        activeRole: "manager",
        branches: [
          { id: BRANCH_A, role: "staff" },
          { id: BRANCH_B, role: "manager" },
        ],
      }),
    );
    await expect(requireCapability("dailyClose", { branchId: BRANCH_A })).rejects.toThrow(
      NOT_FOUND,
    );
    await expect(requireCapability("dailyClose", { branchId: BRANCH_B })).resolves.toBeTruthy();
  });

  it("404s a branch the person cannot reach at all", async () => {
    // Not "least privilege" - no grant. A branch missing from scope is a branch RLS did not
    // return, and it has to answer the same as a branch id that does not exist.
    loadScope.mockResolvedValue(
      scope({ activeRole: "owner", branches: [{ id: BRANCH_B, role: "owner" }] }),
    );
    await expect(requireCapability("recordSale", { branchId: BRANCH_A })).rejects.toThrow(
      NOT_FOUND,
    );
  });

  it("gives an owner every capability at every branch they hold", async () => {
    const s = scope({ activeRole: "owner", branches: [{ id: BRANCH_A, role: "owner" }] });
    loadScope.mockResolvedValue(s);
    for (const cap of ["manageOrganisation", "dashboard", "dailyClose", "recordSale"] as const) {
      await expect(requireCapability(cap, { branchId: BRANCH_A })).resolves.toBe(s);
    }
  });
});
