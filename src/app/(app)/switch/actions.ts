"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACTIVE_BRANCH_COOKIE, canReachBranch } from "@/lib/scope";

/**
 * Set the active branch.
 *
 * The check is not decoration. A server action is a public endpoint - anyone can post to it with
 * any branch id - so `canReachBranch` asks RLS whether this user can see that branch before the
 * cookie is written. It would still be safe without this, because `loadScope` discards a cookie
 * naming a branch the policies did not return, but "safe because something downstream rechecks it"
 * is how a rule survives until the day somebody reads the cookie directly.
 *
 * Refusal is silent - back to the switcher, no error. There is nothing useful to tell someone who
 * has posted an id they should not know about, and "that branch exists but is not yours" is more
 * than they should learn.
 */
export async function setActiveBranch(formData: FormData): Promise<void> {
  const branchId = formData.get("branchId");
  if (typeof branchId !== "string" || branchId === "") redirect("/switch");

  if (!(await canReachBranch(branchId))) redirect("/switch");

  (await cookies()).set(ACTIVE_BRANCH_COOKIE, branchId, {
    httpOnly: true,
    sameSite: "lax",
    // Read by the server on every request, so it has to survive a browser restart. It is a
    // preference and not a credential - `loadScope` validates it against RLS every time - so a
    // long life costs nothing.
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });

  redirect("/");
}
