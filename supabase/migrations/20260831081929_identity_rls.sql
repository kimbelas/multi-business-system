-- Row level security for the identity and scope tables. Section 5 of the spec.
--
-- The previous migration turned RLS on and defined no policies, which denies every row. That
-- order is the safe one - nothing readable rather than everything - but it means the app can
-- read nothing until this lands. Only the tables that exist are covered here; the money and
-- laundry policies arrive with the tables they protect.

-- ---------------------------------------------------------------- helpers
--
-- `security definer` so a policy on memberships does not recurse into memberships' own RLS,
-- and `stable` so Postgres evaluates each once per statement rather than once per row - the
-- difference between a fast query and one that re-derives the same set thousands of times.
--
-- `set search_path = public` is not decoration: a security definer function resolving an
-- unqualified name through a caller-controlled search_path is the standard way these get
-- hijacked into running someone else's code as their owner.

-- Every org where this user is the owner.
create or replace function public.owned_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id
  from public.memberships
  where user_id = auth.uid() and role = 'owner'
$$;

-- Every branch this user can touch: an owner reaches every branch in the org, everyone else
-- reaches the branches their own membership rows name.
create or replace function public.accessible_branch_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from public.branches b
  join public.businesses biz on biz.id = b.business_id
  where biz.org_id in (select public.owned_org_ids())
  union
  select branch_id
  from public.memberships
  where user_id = auth.uid() and branch_id is not null
$$;

-- The user's role at one branch. Owner beats any branch-level row, so an owner who also holds
-- a staff membership somewhere is still an owner there.
create or replace function public.role_for_branch(target_branch uuid)
returns member_role
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.branches b
      join public.businesses biz on biz.id = b.business_id
      where b.id = target_branch and biz.org_id in (select public.owned_org_ids())
    ) then 'owner'::member_role
    else (
      select role
      from public.memberships
      where user_id = auth.uid() and branch_id = target_branch
      limit 1
    )
  end
$$;

-- Not callable without a session. These read across the whole membership table by design, so
-- `anon` holding execute on them would be a way to enumerate it with no login at all.
revoke execute on function
  public.owned_org_ids,
  public.accessible_branch_ids,
  public.role_for_branch
from anon;

-- ---------------------------------------------------------------- profiles

-- Yourself, plus colleagues at branches you can reach. Staff need to see who recorded a sale;
-- they do not need a directory of the whole organisation.
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or id in (
    select m.user_id
    from public.memberships m
    where m.branch_id in (select public.accessible_branch_ids())
  )
);

-- Yourself only, and `with check` as well as `using`: without the check, a row you are allowed
-- to update could be rewritten to belong to somebody else.
create policy profiles_update on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------- org, business, branch

create policy org_owner_all on public.organizations for all
  using (id in (select public.owned_org_ids()))
  with check (id in (select public.owned_org_ids()));

create policy org_member_read on public.organizations for select using (
  id in (select org_id from public.memberships where user_id = auth.uid())
);

create policy biz_owner_all on public.businesses for all
  using (org_id in (select public.owned_org_ids()))
  with check (org_id in (select public.owned_org_ids()));

create policy biz_member_read on public.businesses for select using (
  id in (
    select b.business_id
    from public.branches b
    where b.id in (select public.accessible_branch_ids())
  )
);

create policy branch_owner_all on public.branches for all
  using (
    business_id in (
      select id from public.businesses where org_id in (select public.owned_org_ids())
    )
  )
  with check (
    business_id in (
      select id from public.businesses where org_id in (select public.owned_org_ids())
    )
  );

create policy branch_member_read on public.branches for select using (
  id in (select public.accessible_branch_ids())
);

-- ---------------------------------------------------------------- memberships

-- The owner manages grants; everyone else reads only their own rows. A staff member able to
-- list this table would have a staff directory with roles attached.
create policy membership_owner_all on public.memberships for all
  using (org_id in (select public.owned_org_ids()))
  with check (org_id in (select public.owned_org_ids()));

create policy membership_self_read on public.memberships for select
  using (user_id = auth.uid());
