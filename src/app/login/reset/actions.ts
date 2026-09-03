"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";

/**
 * Ask for a password reset link. Section 6, item 5: the built-in flow, not a second one.
 *
 * This is the half of card 0028 that was missing, and its absence made a sentence elsewhere false.
 * `reissuePassword` in the settings actions refuses anybody who has ever signed in, and tells the
 * owner "Anyone who has used their account resets it themselves" - which was true of the design and
 * not of the app. It is true now.
 *
 * ## One message, always
 *
 * The same reasoning `signIn` already carries: with self-signup disabled, the set of accounts is
 * the owner's staff list, so anything that answers "does this address have an account" hands that
 * list to whoever asks. Supabase's endpoint is already written to avoid it - an unknown address
 * returns success and sends nothing - and this keeps that property rather than passing through a
 * future error message that does not.
 *
 * **Including the rate limit,** which is the case that costs something real. The built-in mailer
 * allows a couple of messages an hour, so a second attempt inside that window sends nothing and
 * looks identical to success. Reporting that distinctly would be kinder and would also be a side
 * channel, because it is only reached for an address that has an account. So the copy on the page
 * says what to do when no mail arrives instead, and the failure stays on this side of the line.
 */
export async function requestReset(
  formData: FormData,
): Promise<{ sent: true } | { error: string }> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };

  /*
   * The origin, from the request rather than from a variable.
   *
   * Supabase needs an absolute URL to send people back to, and this app runs on three of them:
   * 127.0.0.1 in development, a workers.dev hostname today, and whatever it is given later. An
   * env var for it would be a fourth thing to keep in step and a way to send a live user to a
   * development host. `x-forwarded-proto` is set by the Worker in front of us; the fallback is
   * only reached locally.
   */
  const head = await headers();
  const host = head.get("host");
  const proto = head.get("x-forwarded-proto") ?? "http";
  if (!host) return { error: "Something went wrong. Try again." };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${proto}://${host}/auth/confirm?next=/account/password`,
  });

  /*
   * The result is deliberately not read, and this is the one place in this codebase where that is
   * correct rather than the discarded-result bug it has written down three times. Every outcome -
   * sent, no such account, rate limited - has to produce the same answer, so there is nothing a
   * caller could do with the difference except leak it.
   */
  return { sent: true };
}
