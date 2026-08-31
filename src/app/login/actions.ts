"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Sign in. There is no sign-up counterpart, and that is the design.
 *
 * Section 6: public signup is disabled in the Supabase dashboard and the owner invites staff
 * server-side with the service role key. So this file has one action, and an account that
 * does not exist cannot be created by anyone reaching this page.
 */
export async function signIn(formData: FormData): Promise<{ error: string } | void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    /*
     * One message for a wrong password and for an address that does not exist.
     *
     * Distinguishing them tells anyone who asks which emails have accounts here - and with
     * signup disabled, the set of accounts is the owner's staff list. Supabase's own message
     * is already generic; this keeps it that way rather than passing through a future one
     * that is not.
     */
    return { error: "That email and password do not match an account." };
  }

  // Only reachable on success: redirect throws, so nothing below it runs.
  redirect(next.startsWith("/") ? next : "/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
