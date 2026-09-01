-- `is_active` decides reach. Card 0032.
--
-- `businesses.is_active` and `branches.is_active` existed, rendered as an "Inactive" chip, and were
-- invisible to every policy. Deactivating a branch revoked nothing: it stayed in
-- `accessible_branch_ids()`, stayed selectable, and staff could keep recording against it. The
-- column meant "shows a chip", and an owner reading that chip would reasonably conclude the branch
-- was shut. The distance between those two readings is somebody taking money at a branch the owner
-- believes is closed.
--
-- The spec does not define the column, but it does say what the owner can do: "CRUD businesses,
-- branches" (line 713), alongside staff deactivation being *membership deletion*. Branches are not
-- deleted - history has to survive - so `is_active` is the reversible way to close one, and closed
-- has to mean closed. That is the reading this migration makes true.
--
-- Only the GRANT arm changes. An owner still reaches every branch in an organisation they own,
-- including closed ones, and that is deliberate: whoever closed a branch must be able to see it to
-- reopen it, and a soft delete you cannot see is a hard delete with extra steps.
--
-- A business being closed closes its branches with it. Otherwise `businesses.is_active` stays
-- decorative, which is the defect this card is about, one table up.
--
-- What a staff member is left with, and it is not nothing: `membership_self_read` still returns
-- their own grant, so the app knows they hold one and can say the branch is closed rather than
-- claiming they have no access at all. `src/app/(app)/page.tsx` now distinguishes the three ways a
-- screen can be empty.
--
-- Known follow-up, deliberately not settled here: when `transactions` arrives in phase 3, a closed
-- branch's history stays readable by an owner and stops being readable by the staff who recorded it.
-- That is the right default - the money screens are owner-scoped anyway - but it is a decision that
-- belongs with the table it affects, not with this one.

create or replace function public.accessible_branch_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.branches b
  where b.org_id in (select public.owned_org_ids())
  union
  select m.branch_id
  from public.memberships m
  join public.branches b on b.id = m.branch_id and b.org_id = m.org_id
  join public.businesses bz on bz.id = b.business_id
  where m.user_id = auth.uid()
    and m.branch_id is not null
    and b.is_active
    and bz.is_active
$$;

-- The same rule, or the two disagree. `role_for_branch` answering "staff" for a branch that
-- `accessible_branch_ids()` no longer returns would leave a screen deriving navigation from a role
-- at a branch whose every query comes back empty.
create or replace function public.role_for_branch(target_branch uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.branches b
      where b.id = target_branch and b.org_id in (select public.owned_org_ids())
    ) then 'owner'::public.member_role
    else (
      select m.role
      from public.memberships m
      join public.branches b on b.id = m.branch_id and b.org_id = m.org_id
      join public.businesses bz on bz.id = b.business_id
      where m.user_id = auth.uid()
        and m.branch_id = target_branch
        and b.is_active
        and bz.is_active
      limit 1
    )
  end
$$;

-- Said where somebody would look for it. A column whose meaning lives only in a commit message is
-- how it drifted back to decoration the first time.
comment on column public.branches.is_active is
  'False means closed. Authorization, not display: a closed branch is out of reach for every grant '
  'except an owner''s, who keeps it so they can reopen it. See accessible_branch_ids().';

comment on column public.businesses.is_active is
  'False means closed, and closes every branch under it. Same rule as branches.is_active - '
  'authorization, not display. An owner still reaches it.';
