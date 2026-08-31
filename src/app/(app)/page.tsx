import Link from "next/link";
import { redirect } from "next/navigation";

import { AppearanceRow } from "@/components/ui/appearance-row";
import { Swatch } from "@/components/ui/swatch";
import { businessLabel } from "@/lib/business";
import { loadScope } from "@/lib/scope";

/**
 * Where a signed-in person lands.
 *
 * Section 6, step 3 splits two ways and this is where the split happens: somebody with exactly one
 * branch goes straight to it and never sees a switcher, and anybody with more than one gets this
 * list. An owner always gets the list even with one branch, because the list is also where they go
 * to add the second.
 *
 * Everything shown comes back through RLS with the anon key. That is the point rather than an
 * implementation detail: if the policies are wrong this page is empty instead of showing data it
 * should not, so a screen that renders is a screen a policy allowed.
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
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{scope.orgName ?? "Bizdesk"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {scope.email} &middot; {scope.role}
        </p>
      </header>

      {scope.businesses.length === 0 && (
        /*
         * Not a generic empty state. An account with no membership signs in perfectly and reads
         * nothing, because owned_org_ids() is empty - so this names that cause rather than implying
         * the data does not exist. `tests-rls/scope.test.ts` covers the same case as the
         * `outsider` persona.
         */
        <div className="mt-8 rounded-xl border border-dashed border-border p-6">
          <p className="font-medium">No businesses you can reach</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account has no membership yet. Someone with owner access has to grant one before
            anything here is visible to you.
          </p>
        </div>
      )}

      <ul className="mt-8 flex flex-col gap-4">
        {scope.businesses.map((business) => (
          <li key={business.id} className="rounded-xl border border-border p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="flex items-center gap-2.5 text-lg font-medium">
                <Swatch type={business.type} />
                {business.name}
              </h2>
              <span className="text-xs tracking-wide text-muted-foreground uppercase">
                {businessLabel(business.type)}
              </span>
            </div>

            <ul className="mt-3 flex flex-col gap-1.5">
              {business.branches.length === 0 && (
                <li className="text-sm text-muted-foreground">No branches yet</li>
              )}
              {business.branches.map((branch) => (
                <li key={branch.id} className="text-sm">
                  <Link
                    href={`/b/${branch.id}`}
                    className="inline-flex items-center gap-2 underline underline-offset-4"
                  >
                    <span
                      aria-hidden
                      className={`size-1.5 rounded-full ${
                        branch.isActive ? "bg-commit" : "bg-muted-foreground"
                      }`}
                    />
                    {branch.name}
                  </Link>
                  {!branch.isActive && (
                    <span className="ml-2 text-muted-foreground">(inactive)</span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">{branch.role}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {branchCount > 1 && (
        <p className="mt-8 text-sm">
          <Link href="/switch" className="underline underline-offset-4">
            Switch branch
          </Link>
          <span className="text-muted-foreground">
            {" "}
            &mdash; sets which branch the app is scoped to.
          </span>
        </p>
      )}

      <AppearanceRow className="mt-10" />

      <p className="mt-10 text-xs text-muted-foreground">
        Everything above was read with the anon key through row level security. Nothing on this page
        bypasses a policy.
      </p>
    </main>
  );
}
