/**
 * Cookie names, in a module that anything may import.
 *
 * `lib/scope.ts` is where the active branch is read and `switch/actions.ts` is where it is
 * written, and the name lived in the first of those. That module opens with `import "server-only"`,
 * so a test importing the name through it fails to load at all - the same wall that sent
 * `activeRoleFor` and `highest` to `lib/rbac.ts`, and for the same reason.
 *
 * The alternative was a second copy of the string in the e2e spec that forges this cookie, and that
 * copy would fail in the direction that does not show up: a rename would leave the spec setting a
 * cookie nobody reads, `loadScope` would fall back to the user's own branch, and the assertion that
 * a forged value changes nothing would pass **because the forgery had stopped working**. A guard
 * that cannot fail is the defect shape this repository keeps finding in itself.
 */

/**
 * Which branch the app is pointed at. A preference, never a permission.
 *
 * `loadScope` looks the value up in the branches RLS returned and discards one that is not there,
 * so editing it names a branch you already had. `tests-rls/scope.test.ts` asserts the database has
 * no notion of it at all, and `tests-e2e/switch.authed.spec.ts` forges it in a browser.
 */
export const ACTIVE_BRANCH_COOKIE = "bizdesk_branch";
