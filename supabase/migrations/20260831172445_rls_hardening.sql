-- Hardening for the identity and scope policies. Four defects, one of them a real hole.
--
-- All four are the same family: the authorization model is spread across a schema, five helper
-- functions and eight policies, and each defect is a place where one of those three was trusted
-- to say something it does not actually say.
--
-- ## 1. A branch grant could name another organisation's branch
--
-- `memberships` carries both `org_id` and `branch_id` and nothing tied them together. The
-- table's own comment calls itself THE authorization model, and both check constraints guard
-- the *shape* of a grant - an owner is org-wide, a manager names a branch - while neither
-- guards its *tenancy*. So this row was accepted:
--
--   (user, org_id = A, branch_id = <a branch belonging to org B>, role = 'manager')
--
-- and `accessible_branch_ids()` returned that branch, because its second arm selected
-- `branch_id` from memberships without ever asking which org the branch was in. One org's
-- owner could therefore grant standing access to another org's branch. Today the only writer
-- is `membership_owner_all`, so it takes an owner to do it; the staff-invite flow in section
-- 9.7 is not built yet and `createAdminClient` has no callers, which is the whole reason to fix
-- this now - that flow runs with the service role, and the service role bypasses RLS but not a
-- constraint.
--
-- Fixed declaratively rather than in the policies. `branches` gains the `org_id` it always
-- implied, kept honest by a composite foreign key to `businesses (id, org_id)`, and
-- `memberships (branch_id, org_id)` then references `branches (id, org_id)`. MATCH SIMPLE is
-- what makes that work for owners: a row with a null `branch_id` skips the check, which is
-- exactly the shape `owner_is_org_wide` requires. A trigger would have been the smaller diff
-- and a worse answer - it can be disabled, it does not describe itself to the planner, and
-- there would be nothing to stop the next writer bypassing it.
--
-- ## 2. `profiles_select` returned nobody but yourself
--
-- Its stated intent is "yourself, plus colleagues at branches you can reach", and it read
-- `memberships` as a plain subquery to find them. A subquery inside a policy is itself subject
-- to the target table's RLS - this codebase already learned that as 42P17, and 20260831090000
-- fixed the two policies where the consequence was recursion. This is the third, where the
-- consequence was silence instead: for a staff member, `membership_self_read` reduces that
-- subquery to their own single row, so the policy collapsed to `id = auth.uid()` and no staff
-- member could see who they work with. Fail-closed, so nothing leaked - but the policy did not
-- do what it says, and section 5's reason for it ("staff need to see who recorded a sale") was
-- not met.
--
-- ## 3. `org_member_read` read `memberships` directly too
--
-- Same shape, and it *works* - but only because its filter, `user_id = auth.uid()`, happens to
-- be the same predicate `membership_self_read` would have applied anyway. It is correct by
-- coincidence of alignment, which is not a property worth keeping. After this migration the
-- rule has no exceptions: **no policy reads a sibling table directly; every cross-table read
-- goes through a `security definer` helper.** A rule with one "it happens to line up" carve-out
-- is how the next one gets written.
--
-- ## 4. `revoke execute ... from anon` did not revoke anything
--
-- `create function` grants EXECUTE to `PUBLIC`, and `PUBLIC` is a pseudo-role every role
-- carries. Revoking from `anon` removes a grant made to `anon` specifically and leaves the
-- PUBLIC one in place, so `anon` kept the privilege that both earlier migrations state it does
-- not have. The blast radius was small - every one of these functions is scoped by
-- `auth.uid()`, which is null without a session, so they return nothing rather than the tenancy
-- the comment feared - but a guard that does not guard is worth strictly less than no guard,
-- because it is believed. Revoked from PUBLIC and granted to `authenticated` explicitly.
--
-- `handle_new_user` is deliberately left alone: whether PostgreSQL re-checks EXECUTE on a
-- trigger function at fire time or only at creation time decides whether revoking it breaks the
-- only path by which anyone gets an account, and that is a question to answer against a
-- database rather than in a comment.
--
-- Also tightened here: every helper moves from `set search_path = public` to `set search_path =
-- ''`. All of them already schema-qualify every reference, so this costs nothing and removes the
-- class of attack the existing comments describe rather than narrowing it.

-- ---------------------------------------------------------------- 1. tenancy, declared

-- `id` is already the primary key; this composite is what lets `branches` reference the pair.
alter table public.businesses
  add constraint businesses_id_org_key unique (id, org_id);

alter table public.branches
  add column org_id uuid;

-- Backfill before NOT NULL. Every existing branch reaches its org through its business, which
-- is the derivation this column makes explicit rather than a new fact about the data.
update public.branches b
   set org_id = biz.org_id
  from public.businesses biz
 where biz.id = b.business_id;

-- `org_id` is derived, never supplied. A NOT NULL column with no default would have broken
-- every existing `insert into branches (business_id, name)` - the persona fixture, the
-- owner-creates-a-branch assertion, and the branch admin from section 9.7 that is not written
-- yet - and "pass the org too" is a requirement each of those callers could get wrong.
--
-- So the trigger *supplies* the value and the foreign key *enforces* it: enforcement stays
-- declarative, and this is a default in the only form a default can take when it comes from
-- another table. It overwrites rather than fills, so a caller naming someone else's org on
-- insert gets its own business's org written over the top.
--
-- It fires on insert and on a change to `business_id`, which leaves one path it does not cover:
-- an UPDATE touching only `org_id`. That is deliberate rather than missed - the composite
-- foreign key rejects it, because the forged (business_id, org_id) pair does not exist in
-- `businesses`. So the two paths differ on purpose: a forge at insert time is silently corrected
-- and a forge afterwards is a loud constraint error. Neither is a way in, and the enforcement is
-- the key in both cases, never the trigger.
create function public.branches_set_org_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select biz.org_id into new.org_id
  from public.businesses biz
  where biz.id = new.business_id;
  return new;
end;
$$;

create trigger branches_org_id_derived
before insert or update of business_id on public.branches
for each row
execute function public.branches_set_org_id();

alter table public.branches
  alter column org_id set not null;

-- The denormalised column cannot drift: the pair has to exist in `businesses`. `on update
-- cascade` so moving a business between orgs stays possible and stays consistent, rather than
-- being blocked by its own branches.
alter table public.branches
  add constraint branches_business_org_fk
  foreign key (business_id, org_id) references public.businesses (id, org_id)
  on update cascade on delete cascade;

alter table public.branches
  add constraint branches_id_org_key unique (id, org_id);

-- The hole, closed. A grant naming a branch must name that branch's org. A null `branch_id`
-- passes under MATCH SIMPLE, which is the owner case.
alter table public.memberships
  add constraint memberships_branch_in_org_fk
  foreign key (branch_id, org_id) references public.branches (id, org_id)
  on update cascade on delete cascade;

-- ---------------------------------------------------------------- helpers

create or replace function public.owned_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id
  from public.memberships
  where user_id = auth.uid() and role = 'owner'::public.member_role
$$;

-- Owners reach every branch in the org, which `branches.org_id` now answers without a join.
-- Everyone else reaches the branches their own grants name - and the join to `branches` on BOTH
-- id and org is the defence in depth behind the new foreign key: a mismatched row, if one ever
-- existed again, would grant nothing rather than granting across a tenancy.
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
  where m.user_id = auth.uid() and m.branch_id is not null
$$;

-- Owner beats any branch-level row, so an owner who also holds a staff membership somewhere is
-- still an owner there.
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
      where m.user_id = auth.uid() and m.branch_id = target_branch
      limit 1
    )
  end
$$;

create or replace function public.owned_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.businesses
  where org_id in (select public.owned_org_ids())
$$;

create or replace function public.accessible_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct b.business_id
  from public.branches b
  where b.id in (select public.accessible_branch_ids())
$$;

-- New, for defect 2: yourself plus colleagues at branches you can reach, resolved without the
-- `profiles` policy having to read `memberships` under the reader's own RLS.
create or replace function public.visible_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid()
  union
  select m.user_id
  from public.memberships m
  where m.branch_id in (select public.accessible_branch_ids())
$$;

-- New, for defect 3. The same set the inline subquery produced; no longer by coincidence.
create or replace function public.member_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id
  from public.memberships
  where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------- 4. execute, spelled to bite

-- PUBLIC is the grant `create function` actually makes, and the one every role inherits.
revoke execute on function
  public.owned_org_ids(),
  public.accessible_branch_ids(),
  public.role_for_branch(uuid),
  public.owned_business_ids(),
  public.accessible_business_ids(),
  public.visible_profile_ids(),
  public.member_org_ids()
from PUBLIC;

-- Explicitly as well, in case a direct grant to `anon` ever preceded one of the earlier
-- revokes. Revoking a privilege nobody holds is not an error.
revoke execute on function
  public.owned_org_ids(),
  public.accessible_branch_ids(),
  public.role_for_branch(uuid),
  public.owned_business_ids(),
  public.accessible_business_ids(),
  public.visible_profile_ids(),
  public.member_org_ids()
from anon;

-- The app runs as `authenticated` and every policy below calls these, so this half is not
-- optional: without it the revoke above closes the application rather than the anon hole.
grant execute on function
  public.owned_org_ids(),
  public.accessible_branch_ids(),
  public.role_for_branch(uuid),
  public.owned_business_ids(),
  public.accessible_business_ids(),
  public.visible_profile_ids(),
  public.member_org_ids()
to authenticated;

-- ---------------------------------------------------------------- policies

-- Defect 2. The same intent as section 5, now actually reachable.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id in (select public.visible_profile_ids())
);

-- Defect 3.
drop policy if exists org_member_read on public.organizations;
create policy org_member_read on public.organizations for select using (
  id in (select public.member_org_ids())
);

-- `branches` now carries `org_id`, so the owner's write policy can say what it means directly
-- instead of going through `owned_business_ids()`. Identical set, one fewer indirection.
drop policy if exists branch_owner_all on public.branches;
create policy branch_owner_all on public.branches for all
  using (org_id in (select public.owned_org_ids()))
  with check (org_id in (select public.owned_org_ids()));

-- ---------------------------------------------------------------- indexes

-- `accessible_branch_ids()` joins memberships to branches on (id, org_id) on effectively every
-- query, and the new foreign key needs the same pair.
create index branches_org_id_idx on public.branches (org_id);
