import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the session cookie on every request, and gates the app.
 *
 * Section 6 of the spec. Two things here are easy to get wrong and both are load-bearing:
 *
 *  - **The response object is reused, not rebuilt.** `supabase.auth.getUser()` may issue a
 *    refreshed token, and that cookie has to land on the response that is actually returned.
 *    Creating a fresh NextResponse after the call throws the refreshed cookie away, and the
 *    symptom is a user being signed out at an interval nobody can explain.
 *  - **`getUser()`, never `getSession()`.** getSession reads the cookie and believes it;
 *    getUser verifies it with the auth server. On the request that decides whether to let
 *    someone into the app, believing an unverified cookie is the whole problem.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet) {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith("/login") || path.startsWith("/auth");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Where they were going, so signing in lands there rather than at a generic home.
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  /*
   * Everything except static assets and the cron route.
   *
   * The cron route is excluded deliberately: it is called by a Cloudflare Cron Trigger with
   * no session at all, and authenticates with the CRON_SECRET header instead. Running it
   * through this middleware would redirect the scheduler to a login page.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/cron|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
