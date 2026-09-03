"use server";

import { createClient } from "@/lib/supabase/server";

import { MIN_PASSWORD } from "./policy";

/**
 * Set a new password for whoever is signed in.
 *
 * Reached two ways and it does not care which: from a reset link, where the session was minted
 * moments ago by `/auth/confirm`, or from inside the app by somebody who simply wants to change it.
 * `updateUser` acts on the session, so there is no user id to pass and none to forge - which is why
 * this action takes a password and nothing else.
 *
 * The floor itself lives in `./policy` rather than here, and not for tidiness: a `"use server"`
 * module may export only async functions, so the constant that used to sit at the top of this file
 * left the module with no exports at all - this action included. See that file.
 *
 * The confirmation field is not ceremony either. Somebody arriving from a reset link has already
 * lost their password once; a typo in the only field would send them straight back through the
 * mail, and on the built-in mailer's rate limit that is a wait rather than a retry.
 */
export async function setPassword(formData: FormData): Promise<{ ok: true } | { error: string }> {
  const password = String(formData.get("password") ?? "");
  const again = String(formData.get("again") ?? "");

  if (password.length < MIN_PASSWORD) {
    return { error: `Use at least ${MIN_PASSWORD} characters.` };
  }
  if (password !== again) {
    return { error: "Those two do not match." };
  }

  const supabase = await createClient();

  /*
   * Asked, not assumed. `updateUser` needs a session, and this route is behind the middleware -
   * but "behind the middleware" is a claim about another file, and the failure if it were ever
   * wrong is a password change reported as done against no account at all.
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your link has expired. Ask for another one." };

  const { error } = await supabase.auth.updateUser({ password });

  /*
   * Supabase's message, passed through rather than replaced. The refusals it produces here are
   * about the password itself - a project-level minimum stricter than ours, a value found in a
   * breach list where that check is enabled - and they tell the person what to change. This is the
   * opposite case from `signIn`, where the specific reason is exactly what must not be said.
   */
  if (error) return { error: error.message };

  return { ok: true };
}
