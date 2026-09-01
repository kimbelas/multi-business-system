"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/authz";
import { ROLES, type Role } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The write half of card 0019: invite somebody, and take their access away.
 *
 * ## Every action re-authorizes itself
 *
 * `/settings` is guarded by `requireCapability`, and that guard protects the *render*. It does not
 * protect these. Next's own guidance is unambiguous — a Server Action compiles to an action id and
 * a POST endpoint on the page, so "the route is reachable to anyone who can send the same POST",
 * and "render-time gating is not a security boundary, because requests can be sent without going
 * through the UI". So each action below calls `requireCapability` again as its first statement.
 *
 * RLS is still the thing that actually enforces it. Note what the re-check does and does not do:
 * `requireCapability` calls `notFound()`, which THROWS - so a caller does not receive
 * `{ ok: false }` on the unauthorized path, it receives the not-found boundary. That is the right
 * answer for somebody who should not be here, and it is not a validation message. The
 * `ActionResult` failures below are for an owner who got something wrong.
 *
 * ## The client says which, never what
 *
 * The same guidance: "a client legitimately tells the server which item to act on, but it should
 * not supply the row's contents or ownership. Send a reference plus the user's change, and re-read
 * the rest from a trusted source using the session." So a branch id arriving in a form is checked
 * against the branches `loadScope` returned - which are the branches RLS returned - and the org is
 * never taken from the request at all.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
  /**
   * What was typed, echoed back so a failure does not empty the form.
   *
   * React calls `requestFormReset` before invoking a form action, unconditionally - so an
   * uncontrolled `<form action={fn}>` clears on every submit, including the ones that return an
   * error. The owner would read "somebody already has an account with that email" above four empty
   * fields, with the address they typed gone.
   */
  submitted?: { email: string; name: string; role: string; branchId: string };
  /**
   * Shown once, never stored, and only on success.
   *
   * No SMTP is configured for this project, so `inviteUserByEmail` would depend on Supabase's
   * built-in sender - rate limited and documented as unsuitable for production. Until a sender
   * exists, the owner creates the account and hands over the password, which is the flow a shop
   * actually runs: the owner is standing next to the person.
   */
  tempPassword?: string;
}

/** Roles a person can be invited as. Owner is deliberately absent - see `inviteStaff`. */
const INVITABLE = ["manager", "staff"] as const satisfies readonly Role[];

function fail(message: string, submitted?: ActionResult["submitted"]): ActionResult {
  return { ok: false, message, submitted };
}

export async function inviteStaff(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  // First statement, not a decoration. See the note above.
  const scope = await requireCapability("manageOrganisation");

  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const role = String(form.get("role") ?? "");
  const branchId = String(form.get("branchId") ?? "");

  // Echoed back on every failure below, so a refusal costs a correction rather than a
  // retype. React calls requestFormReset before invoking a form action unconditionally,
  // so an uncontrolled form clears itself even when the action returns an error.
  const submitted = { email, name, role, branchId };

  if (!email || !email.includes("@"))
    return fail("Enter the email address they will sign in with.", submitted);
  if (!(INVITABLE as readonly string[]).includes(role)) return fail("Choose a role.", submitted);
  if (!ROLES.includes(role as Role)) return fail("Choose a role.", submitted);

  /*
   * Owner is not invitable here, and that is a decision rather than an omission. An owner grant is
   * org-wide by constraint (`owner_is_org_wide`), so it cannot be scoped to the branch this form
   * collects - and a second owner is a change to who controls the organisation, which should not
   * share a button with hiring a counter assistant.
   *
   * The database refuses the malformed version of this regardless: an owner row naming a branch
   * violates the check constraint. Card 0019's last criterion is exactly that, and the persona
   * suite asserts it.
   */

  // The branch must be one this person can actually reach, checked against what RLS returned
  // rather than against what the form claimed.
  /*
   * The branch is looked up together with its business, so the org comes from the branch rather
   * than from the session's arbitrary `scope.orgId`.
   *
   * `requireCapability("manageOrganisation")` establishes that this person may manage *an*
   * organisation - `activeRoleFor` returns "owner" for anybody holding any org-wide owner grant.
   * It does not establish that the org being written to is that one. For somebody who owns org A
   * and holds a branch grant in org B - the plan's own assumption, "one person can hold different
   * roles at different branches" - `scope.orgId` may resolve to either, and this action would
   * build a grant for whichever it happened to pick. RLS and `memberships_branch_in_org_fk` refuse
   * the wrong combination, so nothing crosses a tenancy; what it produced was a coin flip that
   * burned an email address on every losing toss.
   */
  const found = scope.businesses
    .flatMap((business) => business.branches.map((branch) => ({ branch, business })))
    .find((entry) => entry.branch.id === branchId);
  if (!found) return fail("Choose a branch.", submitted);
  const { branch, business } = found;

  const admin = createAdminClient();

  /*
   * A password rather than an email link, because there is no sender. 24 bytes of base64url is
   * comfortably past the project's 6-character minimum and is never persisted by us - Supabase
   * stores only its hash, and this function returns it once for the owner to read aloud.
   */
  const tempPassword = randomBytes(24).toString("base64url");

  const created = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: name || email },
  });

  if (created.error) {
    // The common case is a duplicate, and saying so is more useful than the raw message.
    const duplicate = /already|exists|registered/i.test(created.error.message);
    return fail(
      duplicate
        ? "Somebody already has an account with that email. Grant them access instead of inviting them again."
        : `Could not create the account: ${created.error.message}`,
      submitted,
    );
  }

  const userId = created.data.user?.id;
  if (!userId)
    return fail("The account was created but returned no id. Check the users list.", submitted);

  /*
   * The grant goes in through the OWNER's session, not the service role.
   *
   * `membership_owner_all` already permits exactly this insert, so using the admin client here
   * would bypass a policy that is willing to allow the operation - and would mean the one write
   * that decides who can see money never passes through the layer the whole app trusts.
   *
   * `org_id` comes from the session's scope, never from the form. The composite foreign key added
   * in 20260831172445 refuses a branch belonging to another org even if this were wrong.
   */
  const supabase = await createClient();
  const grant = await supabase.from("memberships").insert({
    user_id: userId,
    org_id: business.orgId,
    branch_id: branch.id,
    role,
  });

  if (grant.error) {
    /*
     * The account exists and the grant does not - the one partly-done state this action reaches.
     * The account is removed rather than left behind, because an auth user with no membership can
     * sign in and read nothing: broken to them, successful to the owner.
     *
     * The result of that removal is READ, and this is the whole point. `deleteUser` does not throw
     * on an HTTP failure - it catches AuthError and returns `{ data, error }` - so the `.catch()`
     * this used to rely on covered only a network throw, and the return value was discarded in
     * every case. The message said "the account was removed" without having looked.
     *
     * What that cost: a failed cleanup leaves the auth user in place, the owner is told it is
     * gone, and the retry hits "somebody already has an account with that email". There is no
     * grant-access control, no password reset without a mailer, and no delete-user control, so
     * that address becomes permanently unusable from inside the app - the exact outcome this card
     * exists to remove. A wrong reassurance is worse than an error.
     */
    const cleanup = await admin.auth.admin.deleteUser(userId);
    if (cleanup.error) {
      return fail(
        `Could not grant access (${grant.error.message}), and the half-made account for ${email} ` +
          `could not be removed either (${cleanup.error.message}). That address cannot be invited ` +
          `again until the account is deleted in Supabase.`,
        submitted,
      );
    }
    return fail(
      `Could not grant access, so the account was removed: ${grant.error.message}`,
      submitted,
    );
  }

  revalidatePath("/settings");
  return {
    ok: true,
    message: `${email} can sign in now as ${role} at ${branch.name}.`,
    tempPassword,
  };
}

export async function revokeGrant(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const scope = await requireCapability("manageOrganisation");

  const membershipId = String(form.get("membershipId") ?? "");
  if (!membershipId) return fail("Nothing was selected.");

  const supabase = await createClient();

  /*
   * Read the row before deleting it, for two reasons that are not the same.
   *
   * The first is the lockout. An owner revoking their own org-wide grant loses `owned_org_ids()`,
   * which is the basis of every policy that lets them manage anything - including this screen and
   * this action. There is no path back through the app: the only fix is SQL against the database,
   * which is precisely what card 0019 exists to stop being necessary. So it is refused.
   *
   * The second is loudness. RLS would make a foreign row's delete affect zero rows rather than
   * error, and Next's guidance on destructive operations asks for "a loud failure when those
   * checks miss" - a silent success on a delete that deleted nothing is the worst available
   * outcome for an action whose whole job is removing access.
   */
  const { data: row, error: readError } = await supabase
    .from("memberships")
    .select("id, user_id, role, branch_id, org_id")
    .eq("id", membershipId)
    .maybeSingle();

  if (readError) return fail(`Could not read that grant: ${readError.message}`);
  if (!row) return fail("That grant no longer exists, or it is not yours to change.");

  /*
   * The owner rules, which the first version got wrong in both directions.
   *
   * It refused "my own org-wide owner row", which is neither necessary nor sufficient.
   *
   * Not sufficient: an owner could revoke ANOTHER owner. Nothing in this app can create an owner
   * grant - `inviteStaff` deliberately refuses to - so the person removed is locked out
   * permanently and the only way back is SQL, which is precisely the outcome the guard was written
   * to prevent, aimed at somebody else.
   *
   * Not necessary: `unique (user_id, org_id, branch_id)` uses the default NULLS DISTINCT, so two
   * org-wide owner rows for the same person in the same org are permitted. Removing one of those
   * locks nobody out, and the old condition refused it - leaving a duplicate that could only be
   * cleared in SQL.
   *
   * So: count the owners rather than compare identities. Losing the last one orphans the
   * organisation; losing somebody else's is unrecoverable until this screen can grant owner.
   */
  /*
   * No owner grant is removable here, and that is the honest version of a guard that used to be
   * subtler and wrong.
   *
   * It refused "my own org-wide owner row", which let an owner remove ANOTHER owner - unrecoverable,
   * since `INVITABLE` is manager and staff, so nothing in this app can grant owner back. Counting
   * owners fixed the org-orphaning case but still permitted a self-revoke when a second owner
   * existed: the delete succeeded, `revalidatePath` re-rendered, `requireCapability` no longer saw
   * an owner grant, and the person landed on a bare 404 having been told the action was reversible.
   *
   * Since nothing here can undo it, nothing here does it. The dialog can now say "can be given
   * access again later" and be telling the truth for every row it is offered on.
   */
  if (row.role === "owner") {
    return fail(
      "Owner access cannot be removed here — nothing in this app can grant it back, so it would " +
        "take a database change to undo. Do it there if you mean it.",
    );
  }

  const { error: deleteError, count } = await supabase
    .from("memberships")
    .delete({ count: "exact" })
    .eq("id", membershipId);

  if (deleteError) return fail(`Could not remove access: ${deleteError.message}`);
  /*
   * `count !== 1`, not `count === 0`.
   *
   * `count` is `number | null`, and postgrest-js only populates it when the response carries a
   * `content-range` header it can split. PostgREST does send one on a counted DELETE today, so
   * `=== 0` was not dead - but it was one proxy, adapter or header rewrite away from being a guard
   * that cannot fire, and it would have failed by reporting success on a delete that removed
   * nothing. This form catches the refusal AND cannot be satisfied by absence.
   */
  if (count !== 1) {
    return fail("Access was not removed. The database refused the change.");
  }

  revalidatePath("/settings");
  return { ok: true, message: "Access removed." };
}

/**
 * Issue a new password for somebody who already has an account.
 *
 * This exists because the invite hands over a secret exactly once, in a response body, and a
 * response can be lost — a Worker cold start, a phone dropping signal at the counter, a closed tab.
 * Both writes commit, the only copy of the password is gone, and the person cannot sign in, cannot
 * be re-invited (the email is taken), cannot reset it themselves (no mailer), and cannot be
 * removed. The roster would show "Not signed in yet" forever.
 *
 * A one-shot secret with no re-issue path is the trap, not the secret. This is the way out, and it
 * is deliberately the same shape as the invite: a new password, shown once, never stored.
 */
export async function reissuePassword(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  // Called for its refusal, not its return value: this action proves WHICH org below, by reading.
  await requireCapability("manageOrganisation");

  const userId = String(form.get("userId") ?? "");
  if (!userId) return fail("Nothing was selected.");

  /*
   * Asked of the database, not inferred from a row this caller happens to be able to read.
   *
   * The previous version read one membership for the target through RLS and treated a hit as
   * permission for a service-role password write. That read means "they hold a grant in SOME org I
   * own" - which is true of a peer owner, and true of somebody who is staff here and owns another
   * organisation entirely. The second case cannot be checked in app code at all, because RLS
   * correctly hides the other organisation from this caller.
   *
   * `may_reissue_password` is a definer function that sees every grant: it permits only a target
   * whose grants are all inside organisations this caller owns, who is not an owner anywhere, and
   * who has never signed in. That is the stranded-invitation case this exists to rescue, and
   * nothing else.
   */
  const supabase = await createClient();
  const { data: permitted, error: checkError } = await supabase.rpc("may_reissue_password", {
    target: userId,
  });

  if (checkError) return fail(`Could not check that person: ${checkError.message}`);
  if (permitted !== true) {
    return fail(
      "A new password can only be issued for somebody who was invited here and has never signed in. " +
        "Anyone who has used their account resets it themselves.",
    );
  }

  const tempPassword = randomBytes(24).toString("base64url");
  const updated = await createAdminClient().auth.admin.updateUserById(userId, {
    password: tempPassword,
  });

  // Read the result rather than assuming it. Same lesson as the invite's cleanup: this client
  // returns its errors instead of throwing them, so an unchecked call reports a success it never
  // confirmed - and here that would hand the owner a password that does not work.
  if (updated.error) return fail(`Could not set a new password: ${updated.error.message}`);

  return {
    ok: true,
    message: "New password set. It replaces the old one immediately.",
    tempPassword,
  };
}
