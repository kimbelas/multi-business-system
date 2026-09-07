/**
 * The marker CI puts on a value that exists only so a process can start.
 *
 * `ci.yml` hands the e2e job placeholder credentials when the repository secrets are absent - on a
 * fork, or on a clone where nobody has added one. That is deliberate and predates this file: the
 * public specs read no data, but `createServerClient` in the middleware throws without two
 * non-empty strings, so without placeholders the whole suite fails for a reason unrelated to the
 * code under test.
 *
 * What changed on 2026-09-07 is that `instrumentation.ts` now calls `serverEnv()` at startup, so
 * the dev server needs **four** non-empty variables rather than two. Leaving
 * `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` unset would have turned a fork's e2e job from
 * "the authenticated specs skip" into "no server, every spec red".
 *
 * Giving them placeholders creates the opposite hazard: `rlsFullyConfigured()` asks whether the
 * three Supabase variables are present, and a placeholder is present. The authenticated specs
 * would stop skipping and start signing in against a project that is not there. So presence is no
 * longer the question - being *real* is, and this prefix is how a value says it is not.
 *
 * The prefix is not new. `ci.yml` has used `ci-placeholder-anon-key` since the e2e job was
 * written; this only gives the convention a name and a test.
 */
export const CI_PLACEHOLDER_PREFIX = "ci-placeholder";

/** True for a value CI invented to keep a process alive, false for one somebody configured. */
export function isCiPlaceholder(value: string | undefined): boolean {
  return !!value && value.startsWith(CI_PLACEHOLDER_PREFIX);
}
