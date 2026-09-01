import { redirect } from "next/navigation";

import { Swatch } from "@/components/ui/swatch";
import { loadScope } from "@/lib/scope";

import { setActiveBranch } from "./actions";

/**
 * The switcher, and only when there is something to switch.
 *
 * Section 6, step 3: a staff member with exactly one branch never sees this. Reaching it with one
 * branch is not an error worth a message - there is genuinely nowhere else to go - so it redirects
 * home rather than rendering a list of one.
 *
 * Every branch here came back through RLS, so the list is the list of branches this person can
 * reach. The action re-checks anyway; see the note there for why.
 */
export default async function SwitchPage() {
  const scope = await loadScope();
  if (!scope) redirect("/login");
  if (scope.single) redirect("/");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Switch branch</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Sets which branch the app is scoped to. Every query is still re-checked by row level
        security, so this is a convenience and not a permission.
      </p>

      <div className="mt-8 flex flex-col gap-5">
        {scope.businesses.map((business) => (
          <section key={business.id}>
            <h2 className="flex items-center gap-2.5 text-sm font-medium">
              <Swatch type={business.type} />
              {business.name}
            </h2>

            <ul className="mt-2 flex flex-col gap-2">
              {business.branches.length === 0 && (
                <li className="text-sm text-muted-foreground">No branches yet</li>
              )}
              {business.branches.map((branch) => {
                const current = branch.id === scope.activeBranch?.id;
                return (
                  <li key={branch.id}>
                    <form action={setActiveBranch}>
                      <input type="hidden" name="branchId" value={branch.id} />
                      <button
                        type="submit"
                        disabled={current}
                        aria-current={current ? "true" : undefined}
                        className="flex h-pill w-full items-center justify-between rounded-[10px] bg-card px-4 text-left text-[14.5px] shadow-card transition-shadow hover:shadow-none disabled:cursor-default disabled:opacity-60"
                      >
                        <span>
                          {branch.name}
                          {!branch.isActive && (
                            <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {current ? "current" : branch.role}
                        </span>
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
