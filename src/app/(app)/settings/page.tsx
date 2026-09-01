import { Chip, RoleChip } from "@/components/ui/chip";
import { Swatch } from "@/components/ui/swatch";
import { requireCapability } from "@/lib/authz";
import { businessLabel } from "@/lib/business";
import { loadRoster } from "@/lib/roster";

/**
 * Businesses, branches and people. Owner only.
 *
 * Card 0019's read half. The write half — create a branch, invite somebody, revoke a grant — is
 * not here yet, and this screen says so rather than showing buttons that do nothing: that is the
 * whole complaint the rail was just fixed for, and it would be a poor place to reintroduce it.
 *
 * `manageOrganisation` is the capability, which section 7 gives the owner alone. A staff member or
 * a manager typing this URL gets a 404 — see `lib/authz.ts` for why 404 and not 403.
 */
export default async function SettingsPage() {
  const scope = await requireCapability("manageOrganisation");

  /*
   * The org comes from the person's own grant rather than from a parameter. An owner holds exactly
   * one org-wide membership by constraint (`owner_is_org_wide`), so there is nothing to choose
   * between - and a settings screen that took an org id from the URL would be a screen whose
   * authorization depends on a value the caller supplies.
   */
  const roster = scope.orgId ? await loadRoster(scope.orgId) : [];

  const branchName = new Map<string, string>();
  for (const business of scope.businesses) {
    for (const branch of business.branches) branchName.set(branch.id, branch.name);
  }

  const branchCount = scope.businesses.reduce((n, b) => n + b.branches.length, 0);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {scope.orgName ?? "Bizdesk"} &middot; {scope.businesses.length} businesses, {branchCount}{" "}
          branches
          {roster !== null && `, ${roster.length} ${roster.length === 1 ? "person" : "people"}`}
        </p>
      </header>

      <section className="mt-8">
        <h2 className="px-1 text-sm font-medium">Businesses and branches</h2>
        <div className="mt-3 flex flex-col gap-3">
          {scope.businesses.map((business) => (
            /*
             * The business is a label on the ground and the branches are the cards, which is the
             * arrangement docs/01-design.md mandates and `(app)/page.tsx` already uses. The first
             * draft of this screen had it the other way round - a raised business containing plain
             * branch text - so the same three businesses restructured themselves between the
             * dashboard and here, and a branch was a raised object on one screen and a line of text
             * on the other.
             */
            <div key={business.id}>
              <div className="flex items-center justify-between gap-3 px-1">
                <h3 className="flex min-w-0 items-center gap-2.5 text-[15px] font-medium">
                  <Swatch type={business.type} />
                  <span className="truncate">{business.name}</span>
                </h3>
                <span className="flex-none text-xs tracking-wide text-muted-foreground uppercase">
                  {businessLabel(business.type)}
                </span>
              </div>
              {business.branches.length === 0 ? (
                <p className="mt-2 px-1 text-sm text-muted-foreground">No branches yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {business.branches.map((branch) => (
                    <li
                      key={branch.id}
                      className="flex min-h-pill items-center gap-2.5 rounded-xl bg-card px-4 py-2.5 text-[14.5px] shadow-card"
                    >
                      <span className="min-w-0 truncate">{branch.name}</span>
                      {!branch.isActive && <Chip tone="muted">Inactive</Chip>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="px-1 text-sm font-medium">People</h2>
        {roster === null ? (
          /*
           * Could not load, which is a different sentence from "nobody" and used to share one.
           * A successful read always returns at least the viewer's own grant, so an empty list was
           * only ever reachable by an error - and this box used to answer that error by explaining
           * confidently that there was nobody, about a database that holds everybody.
           *
           * It names no cause because it knows none: the project may be paused, or PostgREST's
           * schema cache may be stale after a migration. Both are transient, so it says to retry.
           */
          <p className="mt-3 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            Couldn&apos;t load people just now. Nothing has changed &mdash; try again in a moment.
          </p>
        ) : roster.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            Nobody yet. Grants are added directly in the database until inviting is built.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {roster.map((member) => (
              <li
                key={`${member.userId}-${member.branchId ?? "org"}`}
                className="flex min-h-pill items-center justify-between gap-3 rounded-xl bg-card px-4 py-2.5 shadow-card"
              >
                <span className="min-w-0">
                  {/*
                   * A withheld profile renders as an absence rather than as a name. `full_name` is
                   * NOT NULL, so a missing one means RLS did not return the row - and since
                   * `handle_new_user` writes the literal "Unnamed" for an invite with no name, the
                   * old fallback made a hidden person indistinguishable from a real one.
                   */}
                  <span className="block truncate text-[14.5px]">
                    {member.name ?? (
                      <span className="text-muted-foreground italic">Name not visible to you</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {/*
                     * One row is one grant, so somebody holding manager at one branch and staff at
                     * another appears twice - which is the shape of the data and the thing card
                     * 0019 asks to be visible, not a duplicate to collapse.
                     */}
                    {member.branchId
                      ? (branchName.get(member.branchId) ?? "A branch you cannot reach")
                      : "Whole organisation"}
                  </span>
                </span>
                <RoleChip role={member.role} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-dashed border-border p-4 sm:p-5">
        <h2 className="text-sm font-medium">Not built yet</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Creating a business or branch, inviting someone, and revoking a grant are the rest of this
          screen. Until then those changes happen in the database.
        </p>
      </section>
    </main>
  );
}
