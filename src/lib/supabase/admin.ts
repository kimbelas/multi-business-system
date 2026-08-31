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
 * Used for exactly one thing in v1: inviting staff. There is no public signup, so the owner
 * creating an account for someone is the only path in - and that needs admin. Every other
 * query goes through the anon key and RLS.
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
