/**
 * The password floor, in a module that both sides of the boundary may import.
 *
 * It lived in `actions.ts` next to the check that uses it, which is where a constant belongs right
 * up until that file opens with `"use server"`. **A server-action module may export only async
 * functions**, so exporting a number from it does not merely fail to be useful - Turbopack rejects
 * the module and it ends up with *no exports at all*, including the action. The dev server said so
 * plainly and neither `tsc` nor eslint had a word to say about it:
 *
 *     Only async functions are allowed to be exported in a "use server" file.
 *     The export setPassword was not found in module .../actions.ts. The module has no exports at all.
 *
 * Found by the e2e suite, which is the whole argument card 0031 made: this is a rule the bundler
 * enforces at runtime, so the only gate that could catch it is one that renders the page.
 *
 * Same shape as `lib/cookies.ts` one directory over - a value shared across a boundary needs a home
 * of its own rather than a place inside whichever module happens to use it first.
 *
 * ## Ten, and why it is a decision rather than a default
 *
 * Supabase's own floor is six and the spec names no policy. This password is the only credential in
 * the system: everything the policy suite defends sits behind it, and whoever holds it is that
 * person as far as RLS is concerned. Ten is a compromise with the counter - staff type this on a
 * phone, standing up - not a security position, and it is one constant to change.
 */
export const MIN_PASSWORD = 10;
