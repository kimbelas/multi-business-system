"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * The browser client. Carries the anon key, which is public by design - RLS is what protects
 * the data behind it, not the secrecy of this string.
 *
 * Section 5 of the spec: RLS is the *only* authorization enforcement layer. Anything this
 * client can read, it can read because a policy allows it.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
