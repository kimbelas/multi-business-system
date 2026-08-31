import { requireCapability } from "@/lib/authz";

/**
 * Owner-only. Empty on purpose, and guarded anyway.
 *
 * Card 0019 fills this in - businesses, branches, staff invitations, grants. It exists now, before
 * any of that, so `requireCapability` has a call site: a guard whose only proof is a unit test on
 * itself is the shape this codebase has produced four times, most recently a review that replaced
 * `assertInstructionScoped(...)` with `void assertInstructionScoped;` while 428 tests stayed green.
 *
 * `manageOrganisation` is the capability, which the section 7 matrix gives to the owner and nobody
 * else. A staff member or a manager typing this URL gets a 404, not this page - see `lib/authz.ts`
 * for why 404 rather than 403.
 */
export default async function SettingsPage() {
  const scope = await requireCapability("manageOrganisation");

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {scope.orgName ?? "Bizdesk"} &middot; owner only
        </p>
      </header>

      <div className="mt-8 rounded-xl border border-dashed border-border p-5">
        <p className="font-medium">Not built yet</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Businesses, branches and staff will be managed here. Until then, only you can open this
          page &mdash; that part is already enforced.
        </p>
      </div>
    </main>
  );
}
