import { serverEnv } from "@/lib/env";

/**
 * The call that makes `lib/env.ts` mean anything.
 *
 * `serverEnv()` was written for card 0030's last criterion - a missing variable fails loudly at
 * startup rather than at first use - and was then exported and called from nowhere for three
 * days. The criterion sat ticked on the module existing, which is the same claim one step
 * earlier: nothing failed at startup, because nothing ran at startup.
 *
 * `register()` is Next's one hook that runs per server instance, so this is where it belongs.
 *
 * ## Where this runs, and where it deliberately does not
 *
 * **It does not run during `next build`.** Checked rather than assumed: a build with
 * `CRON_SECRET=""` compiles, typechecks and prerenders all eleven routes without a word. That is
 * the behaviour the deploy workflow depends on - `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are
 * runtime secrets and are deliberately absent from its build step, and this check must not turn
 * that into a failed deploy.
 *
 * **It does run on the Worker.** `@opennextjs/cloudflare` rewrites Next's dynamic `require()` of
 * the instrumentation hook into a static one, because workerd cannot do the dynamic version - so
 * the hook is bundled and called rather than silently dropped. Its `populateProcessEnv` copies
 * every string binding on the Worker into `process.env` before the handler runs, which is what
 * makes a `wrangler secret` visible to this function at all.
 *
 * That second half is why the secrets had to be set first. Until 2026-09-07 the Worker held none
 * of them, and wiring this up before setting them would have thrown on the first request of every
 * cold start - a 500 on every page, from a change whose entire purpose is to make a missing
 * variable obvious.
 */
export function register() {
  serverEnv();
}
