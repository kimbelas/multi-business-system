import "server-only";

import { notFound, redirect } from "next/navigation";

import { type Capability, can } from "@/lib/rbac";
import { type Scope, loadScope } from "@/lib/scope";

/**
 * Route-level authorization: the capability a screen requires, asserted before it renders.
 *
 * ## This is the third layer, not the first
 *
 * RLS is the only thing that *enforces* anything - every query behind every screen is re-checked
 * at the database whatever this decided. `lib/rbac.ts` hides what a role cannot do, so a rail does
 * not offer a door that opens onto nothing. This sits between them and answers a different
 * question: somebody typed the URL.
 *
 * Without it, a staff member navigating to an owner screen gets the screen. Its queries return
 * nothing, because the policies refuse them, so no data leaks - and what they see is a broken
 * page with empty tables rather than an answer. That is the failure this exists to prevent: not a
 * breach, a screen that lies about whether it is for you.
 *
 * ## Why `notFound()` and not a 403
 *
 * Same reasoning as `canReachBranch`, and it has to be the same or the difference is the leak: a
 * branch you cannot reach 404s because "no" and "not found" have to be indistinguishable to
 * somebody probing ids. A 403 on `/settings` says "this exists and is not yours", which is more
 * than a staff member needs to learn about the shape of the app.
 *
 * ## Branch-scoped capabilities
 *
 * Most capabilities are branch-scoped - a manager may close *their* branch - so the role that
 * matters is the role *there*, not the highest one held. Pass `branchId` and the check uses the
 * grant at that branch; omit it and the check uses `activeRole`, the role at whatever branch is
 * currently selected. Passing the wrong one is the `navFor(scope.role)` bug again, one layer up,
 * which is why the parameter exists rather than being inferred.
 */
export async function requireCapability(
  capability: Capability,
  options: { branchId?: string } = {},
): Promise<Scope> {
  const scope = await loadScope();

  // The middleware already redirected an unauthenticated request. Reaching here means it did not,
  // and the answer is the login page rather than a render with `scope!` in it.
  if (!scope) redirect("/login");

  const role = options.branchId ? roleAtBranch(scope, options.branchId) : scope.activeRole;

  // No grant at the named branch is not "least privilege", it is no access: a branch a person
  // cannot reach is not in `scope.businesses` at all, because that is what RLS returned.
  if (role === null || !can(role, capability)) notFound();

  return scope;
}

/**
 * The role a person holds at one branch, or `null` when the branch is not theirs to reach.
 *
 * Distinct from `activeRoleFor`, deliberately. That function answers "what applies where I am
 * standing" and falls back to `staff` for an unknown branch, which is the safe answer for deciding
 * what a rail offers. Here an unknown branch has to be distinguishable from a real staff grant,
 * because the two get different answers: one is a 404 and the other is a screen.
 */
function roleAtBranch(scope: Scope, branchId: string) {
  for (const business of scope.businesses) {
    for (const branch of business.branches) {
      if (branch.id === branchId) return branch.role;
    }
  }
  return null;
}
