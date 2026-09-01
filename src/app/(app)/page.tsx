import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppearanceRow } from "@/components/ui/appearance-row";
import { Chip, RoleChip } from "@/components/ui/chip";
import { Swatch } from "@/components/ui/swatch";
import { businessLabel } from "@/lib/business";
import { roleLabel } from "@/lib/rbac";
import { loadScope } from "@/lib/scope";

/**
 * Where a signed-in person lands.
 *
 * Section 6, step 3 splits two ways and this is where the split happens: somebody with exactly one
 * branch goes straight to it and never sees a switcher, and anybody with more than one gets this
 * list. An owner always gets the list even with one branch, because the list is also where they go
 * to add the second.
 *
 * Everything shown comes back through RLS with the anon key. If the policies are wrong this page is
 * empty rather than showing data it should not, so a screen that renders is a screen a policy
 * allowed. That used to be stated in a line of body copy at the foot of the page, which is a true
 * sentence written for the developer: a staff member opening this on a phone needs to find their
 * branch, and an explanation of the authorization model is noise between them and it.
 *
 * ## Mobile first, meaning thumbs
 *
 * The branches were underlined text links with a 1.5px dot beside them - fine with a mouse, and on
 * the platform the brief calls primary they were a few millimetres of target inside a paragraph.
 * Each branch is now a row of its own at the 46px control floor, which is the same reasoning as the
 * keypad: this is the thing people came here to touch.
 */
export default async function HomePage() {
  const scope = await loadScope();
  if (!scope) redirect("/login");

  // One branch and not the owner: there is nothing to choose, so choosing is not offered.
  if (scope.single && !scope.isOwner && scope.activeBranch) {
    redirect(`/b/${scope.activeBranch.id}`);
  }

  const branchCount = scope.businesses.reduce(
    (total, business) => total + business.branches.length,
    0,
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{scope.orgName ?? "Bizdesk"}</h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="truncate">{scope.displayName || scope.email}</span>
          <RoleChip role={scope.role} />
        </p>
      </header>

      {scope.businesses.length === 0 && (
        /*
         * Not a generic empty state. An account with no membership signs in perfectly and reads
         * nothing, because owned_org_ids() is empty - so this names that cause rather than implying
         * the data does not exist. `tests-rls/scope.test.ts` covers the same case as the
         * `outsider` persona.
         *
         * It says what to do rather than what went wrong, because nothing went wrong: the person
         * reading it cannot fix it themselves and needs to know who can.
         */
        <div className="mt-8 rounded-xl border border-dashed border-border p-5">
          <p className="font-medium">Nothing to show yet</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Your account is not attached to a business. Ask the owner to add you, then sign in
            again.
          </p>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-4">
        {scope.businesses.map((business) => (
          /*
           * The business is a heading on the ground, not a card. Nesting a raised row inside a
           * raised card gives a surface two elevations at once, which in a design that separates
           * by shadow rather than by line reads as a rendering mistake — and it is what the
           * chosen layout does anyway: the branch rows are the cards, and the business name is a
           * label above them.
           */
          <section key={business.id}>
            <div className="flex items-center justify-between gap-3 px-1">
              <h2 className="flex min-w-0 items-center gap-2.5 text-[17px] font-medium">
                <Swatch type={business.type} />
                <span className="truncate">{business.name}</span>
              </h2>
              <span className="flex-none text-xs tracking-wide text-muted-foreground uppercase">
                {businessLabel(business.type)}
              </span>
            </div>

            {business.branches.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No branches yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {business.branches.map((branch) => {
                  const current = branch.id === scope.activeBranch?.id;
                  return (
                    <li key={branch.id}>
                      <Link
                        href={`/b/${branch.id}`}
                        aria-label={`${branch.name} — you are ${roleLabel(branch.role)} here`}
                        className="flex min-h-pill items-center justify-between gap-3 rounded-[10px] bg-card px-3.5 py-2 shadow-card transition-shadow hover:shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <span className="min-w-0 truncate text-[14.5px]">{branch.name}</span>
                        <span className="flex flex-none items-center gap-1.5">
                          {current && <Chip tone="current">Current</Chip>}
                          {!branch.isActive && <Chip tone="muted">Inactive</Chip>}
                          <RoleChip role={branch.role} />
                          <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>

      {branchCount > 1 && (
        <Link
          href="/switch"
          className="mt-4 flex min-h-pill items-center justify-between gap-3 rounded-xl bg-card px-4 py-2.5 shadow-card transition-shadow hover:shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span>
            <span className="block text-sm font-medium">Switch branch</span>
            {/* Was "sets which branch the app is scoped to". Scope is a word from the code. */}
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Choose which branch the app opens on.
            </span>
          </span>
          <ChevronRight aria-hidden className="size-4 flex-none text-muted-foreground" />
        </Link>
      )}

      <AppearanceRow className="mt-10" />
    </main>
  );
}
