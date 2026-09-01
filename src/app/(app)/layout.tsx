import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { destinationsFor } from "@/lib/rbac";
import { loadScope } from "@/lib/scope";

/**
 * Section 6, step 3: the route group that requires a session resolves who you are once, here.
 *
 * The redirect duplicates the middleware deliberately. The middleware is the gate, and this is the
 * assertion that the gate held - if `loadScope` ever returns null inside this group, something has
 * gone wrong upstream and the answer is the login page, not a render with `scope!` in it.
 *
 * Navigation comes from `destinationsFor(scope.activeRole)`, so the rail cannot offer a screen the section 7
 * matrix does not grant *at the branch being looked at*. That hides things; RLS is what enforces
 * them, and every query behind these screens is re-checked there whatever this decided to show.
 *
 * `activeRole` and not `role`: a person can hold manager at one branch and staff at another, and
 * `role` is the highest of those. Deriving the rail from it put manager screens in front of someone
 * standing at a branch where they are staff - refused by RLS on arrival, which is the failure mode
 * `lib/rbac.ts` says this component exists to prevent rather than to demonstrate.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const scope = await loadScope();
  if (!scope) redirect("/login");

  /*
   * Two of these are the shell's own and not capability-gated. Today is where everybody lands, and
   * Switch is an affordance rather than a screen a role may be denied - `loadScope` has already
   * reduced the list to branches RLS returned, so somebody with one branch has nothing to switch
   * between and is not offered it.
   */
  const branchCount = scope.businesses.reduce((n, b) => n + b.branches.length, 0);
  const destinations = [
    { label: "Today", href: "/" },
    ...(branchCount > 1 ? [{ label: "Switch", href: "/switch" }] : []),
    ...destinationsFor(scope.activeRole).map((d) => ({ label: d.item, href: d.href })),
  ];

  return (
    <AppShell
      orgName={scope.activeOrgName ?? "Bizdesk"}
      roleLabel={scope.activeRole[0].toUpperCase() + scope.activeRole.slice(1)}
      userName={scope.displayName}
      businesses={scope.businesses.map((business) => ({
        id: business.id,
        type: business.type,
        current: business.id === scope.activeBusiness?.id,
      }))}
      // A membership can exist with no branch reachable - an owner who has not created one yet -
      // and the shell has to say that rather than render an empty crumb.
      branchName={scope.activeBranch?.name ?? "No branch yet"}
      destinations={destinations}
    >
      {children}
    </AppShell>
  );
}
