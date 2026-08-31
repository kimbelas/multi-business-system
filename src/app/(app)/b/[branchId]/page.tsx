import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppearanceRow } from "@/components/ui/appearance-row";
import { Chip, RoleChip } from "@/components/ui/chip";
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
 *
 * The areas list is the same `can()` call the rail uses, so the two cannot disagree - and it is
 * phrased as what your role *permits* rather than as a menu, because none of those screens exist
 * yet. Presenting them as navigation would be offering doors that open onto nothing, which is the
 * failure mode `lib/rbac.ts` exists to avoid rather than to demonstrate.
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
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
      <header>
        <div className="flex min-w-0 items-center gap-2.5 text-sm text-muted-foreground">
          <Swatch type={business.type} />
          <span className="truncate">{business.name}</span>
          <span className="flex-none text-xs tracking-wide uppercase">
            {businessLabel(business.type)}
          </span>
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{branch.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <RoleChip role={branch.role} />
          {!branch.isActive && <Chip tone="muted">Inactive</Chip>}
        </div>
      </header>

      <section className="mt-8 rounded-xl border border-border p-4 sm:p-5">
        <h2 className="text-sm font-medium">What your role allows here</h2>
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {allowed.map((item) => (
            <li key={item}>
              <Chip>{item}</Chip>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          {/* Was "From the section 7 matrix ... the rail shows the same for the highest role you
           * hold anywhere". The section number means nothing to the person reading it, and the
           * second half stopped being true when the rail started using the role at this branch. */}
          Set by your role at this branch, so the menu shows the same list.
        </p>
      </section>

      <section className="mt-4 rounded-xl border border-dashed border-border p-4 sm:p-5">
        <h2 className="text-sm font-medium">No sales or orders yet</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Recording money and laundry orders arrives in a later release. Nothing is shown here until
          it is real.
        </p>
      </section>

      <Link
        href="/"
        className="mt-6 inline-flex min-h-pill items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronLeft aria-hidden className="size-4 text-muted-foreground" />
        All branches
      </Link>

      <AppearanceRow className="mt-10" />
    </main>
  );
}
