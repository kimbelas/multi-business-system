import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role client. Bypasses RLS completely.
 *
 * `import "server-only"` is the first line for the reason section 11 gives: importing this
 * from anything a client component reaches becomes a BUILD error rather than a service-role
 * key in the browser bundle. That is the difference between a mistake you cannot ship and a
 * mistake you cannot detect.
 *
 * Three jobs in v1, all of them account lifecycle, all in `(app)/settings/actions.ts`:
 *
 *   1. `createUser` - inviting staff. There is no public signup, so the owner creating an
 *      account for somebody is the only path in, and that needs admin.
 *   2. `deleteUser` - undoing 1 when the membership insert fails, so a half-made account
 *      carrying no grant is not left behind for its owner to trip over later.
 *   3. `updateUserById` - a new password for a stranded invitation, gated by
 *      `may_reissue_password`. That gate is a definer function rather than an app-side check
 *      precisely because the app cannot see the grants that would make it unsafe.
 *
 * The list is exhaustive on purpose, and keeping it that way is the job.
 * `20260901045248_who_has_signed_in.sql` refuses to read `auth.users` with this client *because*
 * "the question 'what runs as service role' stops having a short answer" - an argument that only
 * holds while the answer is written down and true. This said "exactly one thing" for a while
 * after there were three, which is worse than having said nothing.
 *
 * Every other query in the app goes through the anon key and RLS.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    // No session persistence: this client is per-request and must never adopt a user's
    // session, or an admin call would silently run as whoever was signed in.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
