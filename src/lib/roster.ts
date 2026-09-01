import "server-only";

import { type Role } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

/**
 * Who holds what, where — the read half of card 0019.
 *
 * Read through the anon key with the owner's session, like everything else, so this cannot show
 * more than `membership_owner_all` allows. That policy is org-wide for an owner and own-rows-only
 * for everybody else, which means a manager who somehow reached this screen would see exactly
 * themselves rather than a staff directory. The route guard refuses them first; this is what makes
 * the refusal not the only thing standing there.
 *
 * The join to `profiles` is the one that was broken until the security pass: `profiles_select` read
 * `memberships` as a plain subquery, and a subquery inside a policy runs under the target table's
 * RLS, so it collapsed to "yourself" for anybody who was not an owner. This screen would have
 * listed a roster of one. It goes through `visible_profile_ids()` now.
 */

export interface Member {
  /**
   * The membership row's own id — the reference `revokeGrant` acts on.
   *
   * Not the user id: one person can hold several grants (manager at one branch, staff at another),
   * so "remove this person" is not a thing the screen can ask for. It removes one grant.
   */
  id: string;
  userId: string;
  /**
   * `null` when RLS withheld the profile row, which is NOT the same as somebody having no name.
   *
   * `profiles.full_name` is `not null`, so a missing name can only mean the row was not visible —
   * and `handle_new_user` writes the literal string "Unnamed" when an invite carries no name, so
   * defaulting to that made a withheld row indistinguishable from a real person called Unnamed.
   */
  name: string | null;
  role: Role;
  /** Null for an org-wide owner grant, which by constraint names no branch. */
  branchId: string | null;
  /**
   * False for somebody invited who has never signed in — the state card 0019 asks to be findable.
   *
   * Comes from `signed_in_members`, a definer function over `auth.users.last_sign_in_at` scoped to
   * organisations the caller owns. Absence from that set is what "not yet" means, so a person whose
   * grant exists but who has never arrived is distinguishable from one who works here daily.
   */
  signedIn: boolean;
}

/**
 * Every grant in the org, newest first, with the person's name. `null` when the read failed.
 *
 * The first version returned `[]` for both an empty result and a failed one, on the reasoning that
 * a page must not throw on a transient filesystem or network state. That rule is satisfied by not
 * throwing; it is not satisfied by asserting a cause — and the two cases are not even distinct
 * here. `orgId` comes from the viewer's own membership row, and `membership_owner_all` returns
 * every grant in an owned org, so a successful read by an owner returns *at least their own row*.
 * An empty array was therefore only ever reachable by an error, and the screen answered it with
 * "Nobody yet. Grants are added directly in the database until inviting is built" — a confident,
 * causal, wrong sentence about a database that holds five grants.
 *
 * The failure is not hypothetical on this stack: the free-tier project auto-pauses after seven idle
 * days, and PostgREST answers PGRST200 on the `profiles` embed while its schema cache is stale
 * after a migration. So: `null` means "could not load", `[]` means "nobody", and the screen says
 * different things for them.
 */
export async function loadRoster(orgId: string): Promise<Member[] | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("memberships")
    .select("id, user_id, role, branch_id, created_at, profiles ( full_name )")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    user_id: string;
    role: Role;
    branch_id: string | null;
    profiles: { full_name: string } | { full_name: string }[] | null;
  };

  if (error) {
    // Logged rather than swallowed: this is the only trace anybody gets that the roster is
    // unavailable, and the screen deliberately does not name a cause it cannot know. Bailing here
    // rather than after the second query, which used to run and be discarded.
    console.error("loadRoster failed", { orgId, code: error.code, message: error.message });
    return null;
  }

  const rows = (data ?? []) as Row[];

  /*
   * Who has ever signed in, asked once for the org rather than once per person.
   *
   * `signed_in_members` returns the EMPTY SET, with no error, when `target_org` is not one the
   * caller owns - so "authorised and nobody has signed in" and "not authorised to ask" arrive
   * identically. Treating the second as authoritative marked every row "Not signed in yet",
   * including the owner reading the screen at that moment: it invented pending invitations for the
   * whole roster, which is the opposite of what the first version of this comment claimed.
   *
   * The consistency check is what separates them. The caller is in this roster and is, by
   * definition, signed in right now. If the set comes back without them, the answer is not about
   * this org and the column is unknown rather than false.
   */
  const { data: signedInRows, error: signedInError } = await supabase.rpc("signed_in_members", {
    target_org: orgId,
  });
  if (signedInError) {
    console.error("signed_in_members failed", { orgId, code: signedInError.code });
  }
  const signedIn = new Set<string>(
    ((signedInRows ?? []) as (string | { signed_in_members: string })[]).map((row) =>
      typeof row === "string" ? row : row.signed_in_members,
    ),
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const answerIsAboutThisOrg =
    user !== null && rows.some((row) => row.user_id === user.id) ? signedIn.has(user.id) : true;
  const knowWhoSignedIn = !signedInError && answerIsAboutThisOrg;

  return rows.map((row) => {
    // PostgREST returns an embedded to-one as an object, and some client versions type it as an
    // array. Normalising here rather than at three call sites.
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      userId: row.user_id,
      name: profile?.full_name ?? null,
      role: row.role,
      branchId: row.branch_id,
      signedIn: knowWhoSignedIn ? signedIn.has(row.user_id) : true,
    };
  });
}
