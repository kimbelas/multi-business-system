-- Grant a role to an account that already exists. Card 0040.
--
-- `inviteStaff` creates the auth user and the membership in one step, so a taken email could only be
-- refused - and its refusal said "Somebody already has an account with that email. Grant them access
-- instead of inviting them again.", pointing at a control that did not exist. It also made the remove
-- dialog's "can be given access again later" false on every row, because removing somebody's last
-- grant left no way back: their address was taken, so the invite form refused them.
--
-- ## Why a definer function rather than an insert from the action
--
-- The action cannot find the target. `memberships.user_id` references `profiles`, `profiles` holds no
-- email, and `auth.users` is not reachable through PostgREST - so app code has no way to turn an email
-- address into the id it would need to insert. The obvious fix is a function that returns that id, and
-- that is the wrong shape: an email-to-uuid lookup callable by any owner is a standing oracle over
-- every account in the system, useful for far more than this one screen.
--
-- So this function does the whole operation and returns a STATUS. The caller learns whether a grant
-- happened; it never learns the user id, and it never learns the person's name. Existence is confirmed
-- only as a side effect of a grant the owner deliberately asked for.
--
-- ## The enumeration this still accepts, deliberately
--
-- An owner can discover whether an address has an account by trying to grant it access, because
-- `no_account` and `granted` are different answers. That was decided rather than overlooked: this is
-- an owner-only screen, owners already see every person in their organisation, and the alternative -
-- granting from the roster - cannot reach the case the card exists for, since somebody whose last
-- grant was removed is not ON the roster. The decision log records it as a chosen trade.
--
-- What it does NOT leak is a name, an id, or anything about an organisation the caller cannot see.
-- An owner learns "that address exists" and, if they go through with it, that person appears on their
-- roster - which is true of anybody they invite.
--
-- ## What it refuses
--
-- Owner. An owner grant is org-wide, so it has no branch to be scoped to, and card 0034 owns that
-- path with a confirmation that says what is being handed over. Passing 'owner' here returns
-- `refused` rather than quietly creating a branch-scoped owner row that `owner_is_org_wide` would
-- reject anyway.

create type public.grant_existing_result as enum ('granted', 'no_account', 'already_has_it', 'refused');

create or replace function public.grant_existing_by_email(
  target_email text,
  target_branch uuid,
  target_role public.member_role
)
returns public.grant_existing_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
  branch_org uuid;
begin
  /*
   * Owner is refused before anything is looked up, so a caller probing with role = 'owner' learns
   * nothing about the address at all.
   */
  if target_role = 'owner'::public.member_role then
    return 'refused'::public.grant_existing_result;
  end if;

  /*
   * The branch decides the organisation, and the caller must own it. Not "must be an owner
   * somewhere" - `owned_org_ids()` is the set they own, and the branch's org has to be in it.
   *
   * Checked before the email is looked up, so somebody who owns nothing cannot use this to probe for
   * accounts: they get `refused` whatever they type.
   */
  select b.org_id into branch_org
  from public.branches b
  where b.id = target_branch
    and b.is_active
    and b.org_id in (select public.owned_org_ids())
    and exists (
      select 1 from public.businesses bz where bz.id = b.business_id and bz.is_active
    );

  if branch_org is null then
    return 'refused'::public.grant_existing_result;
  end if;

  /*
   * The account, by email, case-insensitively - GoTrue lowercases on signup but an owner typing into
   * a form does not.
   *
   * `auth.users` rather than `profiles` because profiles carry no email. This is the one read that
   * makes the function `security definer` necessary.
   */
  select u.id into target_user
  from auth.users u
  where lower(u.email) = lower(trim(target_email))
  limit 1;

  if target_user is null then
    return 'no_account'::public.grant_existing_result;
  end if;

  /*
   * A profile is required, because `memberships.user_id` references it. Every account created since
   * `on_auth_user_created` has one; an account predating that trigger does not, and the honest answer
   * is `refused` rather than an insert that fails on a foreign key the caller cannot see.
   */
  if not exists (select 1 from public.profiles p where p.id = target_user) then
    return 'refused'::public.grant_existing_result;
  end if;

  if exists (
    select 1
    from public.memberships m
    where m.user_id = target_user
      and m.branch_id = target_branch
      and m.role = target_role
  ) then
    return 'already_has_it'::public.grant_existing_result;
  end if;

  /*
   * `org_id` comes from the branch, never from a caller. `memberships_branch_in_org_fk` would refuse
   * a mismatch, and this makes the mismatch unconstructible rather than merely refused.
   *
   * A duplicate at a DIFFERENT role on the same branch is refused by
   * `unique (user_id, org_id, branch_id)` rather than by the check above, which is why that check
   * looks for the exact role: "they already have it" and "they hold a different role there" are
   * different answers, and the unique violation surfaces as an error the caller can report.
   */
  insert into public.memberships (user_id, org_id, branch_id, role)
  values (target_user, branch_org, target_branch, target_role);

  return 'granted'::public.grant_existing_result;
end;
$$;

-- 20260831193202's rule: `create function` grants EXECUTE to PUBLIC, and Supabase's default
-- privileges add `anon` directly, so a revoke naming only PUBLIC reads as protection and is not. The
-- app calls this with a signed-in user's session, so `authenticated` is the one role that keeps it.
revoke execute on function public.grant_existing_by_email(text, uuid, public.member_role) from PUBLIC;
revoke execute on function public.grant_existing_by_email(text, uuid, public.member_role) from anon;
grant execute on function public.grant_existing_by_email(text, uuid, public.member_role) to authenticated;
