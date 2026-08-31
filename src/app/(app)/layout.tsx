import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { navFor } from "@/lib/rbac";
import { loadScope } from "@/lib/scope";

/**
 * Section 6, step 3: the route group that requires a session resolves who you are once, here.
 *
 * The redirect duplicates the middleware deliberately. The middleware is the gate, and this is the
 * assertion that the gate held - if `loadScope` ever returns null inside this group, something has
 * gone wrong upstream and the answer is the login page, not a render with `scope!` in it.
 *
 * Navigation comes from `navFor(role)`, so the rail cannot offer a screen the section 7 matrix
 * does not grant. That hides things; RLS is what enforces them, and every query behind these
 * screens is re-checked there whatever this decided to show.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const scope = await loadScope();
  if (!scope) redirect("/login");

  return (
    <AppShell
      orgName={scope.orgName ?? "Bizdesk"}
      roleLabel={scope.role[0].toUpperCase() + scope.role.slice(1)}
      userName={scope.displayName}
      businesses={scope.businesses.map((business) => ({
        id: business.id,
        type: business.type,
        current: business.id === scope.activeBusiness?.id,
      }))}
      // A membership can exist with no branch reachable - an owner who has not created one yet -
      // and the shell has to say that rather than render an empty crumb.
      branchName={scope.activeBranch?.name ?? "No branch yet"}
      nav={navFor(scope.role)}
    >
      {children}
    </AppShell>
  );
}
