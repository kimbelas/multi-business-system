import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Swatch } from "@/components/ui/swatch";
import { businessLabel } from "@/lib/business";
import { NAV_CAPABILITY, type NavItem, can } from "@/lib/rbac";
import { loadScope } from "@/lib/scope";

/**
 * Branch home.
 *
 * Params typed by hand rather than with Next's generated `PageProps`: that type is written into
 * `.next/types` by a build, so a file using it compiles on a machine that has run `next dev` and
 * fails in a fresh checkout. `tests/generated-types.test.ts` has the whole story.
 *
 * There are no figures here yet and none are invented. The transactions table does not exist -
 * blocked by the phase 1 field-list gate - so this shows what it actually knows: which branch,
 * which business, what you may do here, and what is not built. A screen of plausible pesos would
 * be worse than an honest empty one, because somebody eventually screenshots it as a report.
 */
export default async function BranchHome({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = await params;

  const scope = await loadScope();
  if (!scope) redirect("/login");

  /*
   * Found in what RLS returned, not fetched and then checked.
   *
   * A branch this user cannot reach is not in `scope.businesses` at all, so this is a 404 - the
   * same answer as a branch id that does not exist. Someone probing ids learns nothing either way,
   * which is the point: "no" and "not found" have to look identical.
   */
  const found = scope.businesses
    .flatMap((business) => business.branches.map((branch) => ({ branch, business })))
    .find((entry) => entry.branch.id === branchId);

  if (!found) notFound();
  const { branch, business } = found;

  const allowed = (Object.keys(NAV_CAPABILITY) as NavItem[]).filter((item) =>
    can(branch.role, NAV_CAPABILITY[item]),
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header>
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <Swatch type={business.type} />
          {business.name} &middot; {businessLabel(business.type)}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{branch.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You are {branch.role} here
          {!branch.isActive && " · this branch is marked inactive"}
        </p>
      </header>

      <section className="mt-8 rounded-xl border border-border p-5">
        <h2 className="text-sm font-medium">What you can do at this branch</h2>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {allowed.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          From the section 7 matrix, for your role here. The rail shows the same for the highest
          role you hold anywhere; this list is this branch.
        </p>
      </section>

      <section className="mt-4 rounded-xl border border-dashed border-border p-5">
        <h2 className="text-sm font-medium">Not built yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sale entry, the daily close and the order board all need the money and laundry tables, and
          those migrations are held by the phase 1 field-list gate: no migration is written until
          one branch of each business has a written field list with every field marked &ldquo;must
          add&rdquo; or &ldquo;deliberately dropped&rdquo;.
        </p>
      </section>

      <p className="mt-8 text-sm">
        <Link href="/" className="underline underline-offset-4">
          All branches
        </Link>
      </p>
    </main>
  );
}
