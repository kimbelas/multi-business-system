-- Who may be handed a new password, decided where every grant is visible.
--
-- `reissuePassword` proved the wrong thing. It read one membership row for the target through RLS
-- and treated a hit as authorization for a SERVICE-ROLE write to an account-global credential. That
-- read answers "does this person hold a grant in some organisation I own" - and the write it
-- authorized is "take over this account".
--
-- Two ways through it, both reachable from the roster screen:
--
--   * Peer owner, same org. The roster renders the control on every row. One click hands the
--     clicker a working password for the other owner's account, and there is no way back:
--     signup is disabled, there is no mailer, and nothing in the app can re-grant owner. Revoking
--     another owner's grant is already refused *because it cannot be undone* - this was strictly
--     stronger with no guard at all.
--
--   * Cross-org. X is staff at a branch of org A and the owner of org B. `requireCapability`
--     passes for A's owner, X's org-A row comes back, and A resets the password of org B's owner.
--     Nothing app-side can see that X owns B, because RLS correctly hides org B from A - so the
--     check cannot be written in the app at all. It has to be asked somewhere that sees everything.
--
-- ## What this permits, which is much narrower
--
-- Re-issuing exists for exactly one situation: an invitation was created, the password was shown
-- once, and the response was lost before anybody read it. The account is stranded - it cannot sign
-- in, cannot be re-invited (the address is taken), and cannot reset itself (no mailer). That is
-- worth a rescue.
--
-- It is NOT a general "reset somebody's password" tool, so the function refuses anything else:
--
--   1. The target must hold at least one grant. Nothing here reaches a stranger.
--   2. EVERY grant they hold must be in an organisation the caller owns. This is the cross-org
--      case, and it is the reason this is a definer function rather than app code.
--   3. The target must not be an owner anywhere.
--   4. The target must never have signed in. A working account is not rescued, it is taken over -
--      and a person who has never signed in has never set a password of their own to overwrite.
--
-- Definer rather than a policy because it reads `auth.users`, and scoped by `owned_org_ids()` so
-- the answer is about the caller rather than about the target.

create or replace function public.may_reissue_password(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.memberships m where m.user_id = target)
    and not exists (
      select 1
      from public.memberships m
      where m.user_id = target
        and m.org_id not in (select public.owned_org_ids())
    )
    and not exists (
      select 1
      from public.memberships m
      where m.user_id = target and m.role = 'owner'::public.member_role
    )
    and not exists (
      select 1
      from auth.users u
      where u.id = target and u.last_sign_in_at is not null
    )
$$;

revoke execute on function public.may_reissue_password(uuid) from PUBLIC;
revoke execute on function public.may_reissue_password(uuid) from anon;
grant execute on function public.may_reissue_password(uuid) to authenticated;
