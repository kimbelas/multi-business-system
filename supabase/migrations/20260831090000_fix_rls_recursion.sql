-- Break the businesses <-> branches policy cycle.
--
-- Postgres reported it the first time anything read the two together:
--
--   42P17  infinite recursion detected in policy for relation "businesses"
--
-- ## The cycle
--
-- Section 5.2 defines, as plain subqueries:
--
--   biz_member_read   on businesses  reads branches
--   branch_owner_all  on branches    reads businesses
--
-- A subquery inside a policy is itself subject to the target table's RLS. So evaluating a
-- policy on businesses evaluates a policy on branches, which evaluates a policy on
-- businesses, and so on. Nothing about the data causes it - the shape of the two policies
-- does, so it fails on an empty database just as reliably as a full one.
--
-- ## Why the other cross-table policies are fine
--
-- Every other policy that leaves its own table goes through a `security definer` helper.
-- Those run as the function owner and therefore bypass RLS, which is what terminates the
-- descent. `accessible_branch_ids()` reads branches without triggering branches' policies;
-- these two read their sibling table directly and do trigger them.
--
-- So the fix is not to weaken either policy. It is to give both the same escape the others
-- already had.

-- Businesses in an org this user owns.
create or replace function public.owned_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.businesses
  where org_id in (select public.owned_org_ids())
$$;

-- Businesses this user can reach through any branch they can reach. `distinct` because a
-- business with four accessible branches is still one business, and a policy comparing with
-- `in` does not care but the planner does.
create or replace function public.accessible_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct b.business_id
  from public.branches b
  where b.id in (select public.accessible_branch_ids())
$$;

-- Same reasoning as the first three: these read across the whole tenancy by design, so anon
-- holding execute would be a way to enumerate it without a session.
revoke execute on function
  public.owned_business_ids,
  public.accessible_business_ids
from anon;

-- ---------------------------------------------------------------- replace the two policies

-- Identical intent, no direct read of the sibling table.
drop policy if exists biz_member_read on public.businesses;
create policy biz_member_read on public.businesses for select using (
  id in (select public.accessible_business_ids())
);

drop policy if exists branch_owner_all on public.branches;
create policy branch_owner_all on public.branches for all
  using (business_id in (select public.owned_business_ids()))
  with check (business_id in (select public.owned_business_ids()));
