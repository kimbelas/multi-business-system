-- An owner could not see another owner's name.
--
-- `visible_profile_ids()` is "yourself, plus colleagues at branches you can reach":
--
--   select auth.uid()
--   union
--   select m.user_id from public.memberships m
--    where m.branch_id in (select public.accessible_branch_ids())
--
-- and `owner_is_org_wide` forces `branch_id is null` on every owner grant. `null in (...)` is
-- never true, so an owner row never contributes its person to that set. An owner's own name comes
-- from the `auth.uid()` arm alone, and a SECOND org-wide owner is invisible to the first.
--
-- Nothing forbids two owners: `staff_needs_branch` only requires the converse. So the staff screen
-- would list that person with no name at all, and until this migration's companion commit it
-- rendered them as "Unnamed" - a string `handle_new_user` also writes for real, when an invite
-- carries no full name. A withheld row and a nameless person were the same pixel.
--
-- ## The fix, and why it is not a widening
--
-- An owner already reads every membership row in their organisation (`membership_owner_all`), so
-- they can already enumerate exactly which user ids hold grants there. What they could not do is
-- resolve one of those ids to a name. Adding the org arm gives them nothing they could not already
-- infer, and it is the read the section 9.7 staff admin exists to perform.
--
-- Scoped to `owned_org_ids()` rather than to org membership generally: a manager or staff member
-- gains nothing here, and the branch arm continues to be what lets them see the colleague who
-- recorded a sale.

create or replace function public.visible_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Yourself. The guard is what keeps the set empty rather than {NULL} without a session.
  select auth.uid()
  where auth.uid() is not null
  union
  -- Colleagues at branches you can reach.
  select m.user_id
  from public.memberships m
  where m.branch_id in (select public.accessible_branch_ids())
  union
  -- Everybody holding any grant in an organisation you own, which is the arm that was missing:
  -- an org-wide owner names no branch, so the arm above can never reach one.
  select m.user_id
  from public.memberships m
  where m.org_id in (select public.owned_org_ids())
$$;
