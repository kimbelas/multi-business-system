import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { PasswordForm } from "./password-form";

export const metadata = { title: "Set a new password" };

/**
 * Set a new password. Outside the `(app)` group on purpose.
 *
 * The convention is that `(app)` is the route group that requires a session, and this page requires
 * one too - the middleware gates every path that is not `/login*`, `/auth*` or the dev preview. What
 * it does not need is the shell: somebody who has just followed a reset link has one job here, and
 * wrapping it in navigation invites them to wander off into the app with a password they have not
 * finished setting. It also keeps `loadScope` out of the path, which reads memberships this screen
 * has no use for.
 *
 * The redirect below duplicates the middleware for the reason the `(app)` layout gives for its own:
 * the middleware is the gate and this is the assertion that the gate held. If it ever does not, the
 * answer is the login page rather than a form that would report success against no session.
 */
export default async function PasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/password");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {/* The address, so somebody who holds two accounts knows which one this is about. */}
        For {user.email}.
      </p>
      <PasswordForm />
    </main>
  );
}
