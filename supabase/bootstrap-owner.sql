-- Run ONCE, after both migrations, to make the first account an owner.
--
-- Not a migration, and deliberately not in supabase/migrations/: it names a specific auth
-- user, so replaying it on another database would either fail or wire up the wrong person.
-- Migrations describe the schema; this describes one organisation's first day.
--
-- ## Why a backfill is needed at all
--
-- `on_auth_user_created` creates a profile for every new auth user. The first account was
-- created in the dashboard BEFORE that trigger existed, so no profile row was ever written
-- for it - and a user with no profile cannot hold a membership, because memberships reference
-- profiles. Every account created after the migration gets one automatically; only this one
-- needs catching up.
--
-- ## Why the membership matters more than the login
--
-- RLS is the only authorization layer. An account with no membership row signs in perfectly
-- and then reads nothing: owned_org_ids() returns empty, accessible_branch_ids() returns
-- empty, so there are no businesses and no branches to show. That is correct behaviour, and
-- it is why this file is part of "working" rather than a convenience.

begin;

-- ---------------------------------------------------------------- the owner's profile

-- Idempotent: safe to re-run, and it will not overwrite a name edited later.
insert into public.profiles (id, full_name)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1))
from auth.users u
where u.email = 'itskimmatthewbelas@gmail.com'
on conflict (id) do nothing;

-- ---------------------------------------------------------------- org, businesses, branches

with owner as (
  select id from public.profiles
  where id = (select id from auth.users where email = 'itskimmatthewbelas@gmail.com')
),
org as (
  insert into public.organizations (name, owner_id)
  select 'Belas Group', owner.id from owner
  returning id
),
biz as (
  -- One of each type from section 1. The type drives which extension tables a branch uses, so
  -- these three are the whole of what "multi-business" means in the schema.
  insert into public.businesses (org_id, type, name)
  select org.id, t.type, t.name
  from org
  cross join (values
    ('laundry'::business_type,  'Laundry'),
    ('spa'::business_type,      'Spa'),
    ('skincare'::business_type, 'Skin Care')
  ) as t(type, name)
  returning id, type
),
branch as (
  -- One branch each to start. Adding more is the branch admin screen, not a SQL file - that
  -- was the answer to q9: the roster stops being a blocker because the owner enters it.
  insert into public.branches (business_id, name)
  select biz.id, 'Main branch' from biz
  returning id
)
-- The grant that makes the login mean something. branch_id is null because an owner is
-- org-wide; the `owner_is_org_wide` constraint enforces exactly that.
insert into public.memberships (user_id, org_id, branch_id, role)
select owner.id, org.id, null, 'owner'
from owner, org;

commit;

-- ---------------------------------------------------------------- check it worked

-- Expect: 1 org, 3 businesses, 3 branches, 1 membership with role = owner.
select
  (select count(*) from public.organizations) as orgs,
  (select count(*) from public.businesses)    as businesses,
  (select count(*) from public.branches)      as branches,
  (select count(*) from public.memberships where role = 'owner') as owner_grants;
