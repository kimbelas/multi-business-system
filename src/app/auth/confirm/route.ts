import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Where a reset link lands. The only route that turns a token in a URL into a session.
 *
 * `/auth` is already public in the middleware, which is what makes this reachable by somebody who
 * cannot sign in - the whole point of a reset. It is a Route Handler rather than a page because it
 * has to write the session cookie, which a Server Component cannot do.
 *
 * ## Two shapes of link, one route
 *
 * **`token_hash` + `type`** is the shape to prefer, and it needs the recovery email template
 * pointed here - `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account/password`.
 * Nothing about it is tied to the browser that asked, so a link requested on a laptop opens on a
 * phone, which is what people actually do with their mail.
 *
 * **`code`** is what the default template produces. `resetPasswordForEmail` is called from a server
 * client with PKCE, so Supabase's own verify endpoint bounces back here with a code, and exchanging
 * it needs the verifier cookie that was written when the reset was requested. Same browser only. It
 * is handled because it is what works before the template is edited, not because it is good enough:
 * the cross-device case fails, and it fails looking like an expired link.
 *
 * So both are here, the narrow one is documented on card 0028 as the dashboard change that makes
 * the flow whole, and neither path is a fallback that hides the other being broken.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  /*
   * Where to go afterwards, checked rather than trusted.
   *
   * This value arrives in a URL that anybody can compose, and the redirect happens with a freshly
   * minted session attached - so an unchecked `next` is an open redirect that hands a signed-in
   * user to another origin. `//evil.example` is a URL with a scheme-relative host and it starts
   * with a slash, which is why the second test is not redundant.
   */
  const requested = params.get("next") ?? "/account/password";
  const next =
    requested.startsWith("/") && !requested.startsWith("//") ? requested : "/account/password";

  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");

  const supabase = await createClient();

  /*
   * Only `recovery`, and the narrowness is the point.
   *
   * `verifyOtp` accepts several types, and passing whatever the query string says would make this a
   * general endpoint for turning any emailed token into a session - including `signup`, on a system
   * whose first design decision is that nobody signs themselves up. Recovery is the one flow that
   * exists, so it is the one word accepted; the next flow that needs a type adds itself here
   * deliberately.
   */
  if (tokenHash && type === "recovery") {
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (!error) redirect(next);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(next);
  }

  /*
   * One destination for every failure, and it is the page that can fix it.
   *
   * Expired, already used, malformed, wrong type, or a code exchanged in a browser that never
   * asked - none of those are worth distinguishing to the person holding the link, and the useful
   * next action is identical: ask for another one. `stale` is what that page reads.
   */
  redirect("/login/reset?stale=1");
}
