import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * The server client, for Server Components, Route Handlers and Server Actions.
 *
 * Still the anon key, still subject to RLS - the difference from the browser client is only
 * where the session comes from. A Server Component cannot set cookies, so the write path is
 * wrapped: middleware is what actually refreshes the session, and this swallowing keeps a
 * render from throwing when the library tries.
 */
export async function createClient() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(toSet) {
          try {
            for (const { name, value, options } of toSet) store.set(name, value, options);
          } catch {
            /*
             * Called from a Server Component, where cookies are read-only. Ignored on
             * purpose: `src/middleware.ts` refreshes the session on every request, so the
             * cookie this would have written is already being written there.
             */
          }
        },
      },
    },
  );
}
