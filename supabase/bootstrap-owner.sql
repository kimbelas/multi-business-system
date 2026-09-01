-- Makes the first account an owner. Safe to run more than once.
--
-- Not a migration, and deliberately not in supabase/migrations/: it names a specific auth
-- user, so replaying it on another database would either fail or wire up the wrong person.
-- Migrations describe the schema; this describes one organisation's first day.
--
-- ## It used to say "Run ONCE", and a second run made a whole second business
--
-- Card 0041. The org, businesses, branches and the owner grant had no guard, so running this twice
-- produced two organisations, six businesses, six branches and two owner grants - silently, with no
-- error. Only the `profiles` insert was idempotent, and it said so in a comment, which is what made
-- the rest of the file look safe.
--
-- Proved by accident against the real project: a check that this file still parsed wrapped it in
-- `begin` / `rollback`, and it wrote a duplicate "Belas Group" anyway. Which brings us to the other
-- half of the problem.
--
-- ## This file commits itself, so there is no such thing as a dry run of it
--
-- The `begin;` and `commit;` below are deliberate - they make the whole thing atomic, so a failure
-- part-way leaves no half-built organisation. The cost is that wrapping it in your own transaction
-- does not contain it: its `commit` ends yours, and the `rollback` you were relying on becomes a
-- no-op against an empty transaction.
--
-- If you want to test it, use `pnpm bootstrap:check`, which strips those two statements before
-- running the rest twice inside a transaction it controls.
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
-- ---------------------------------------------------------------- the guard, card 0041
--
-- Everything below selects from this, so if it is empty every insert inserts nothing and a second
-- run is a no-op rather than a second business.
--
-- The condition is "does this person already hold an org-wide owner grant", not "does an
-- organisation named Belas Group exist". Two reasons: `organizations.name` is not unique, so a name
-- test would be a guess; and the owner grant is the thing this file exists to create - RLS is the
-- only authorization layer, so an account without that row can sign in and read nothing. If the
-- grant is there, the file has already done its job.
--
-- Safe against a half-built state because there is no such state: the transaction around this makes
-- all four inserts atomic, so either the grant exists and everything else does too, or none of it
-- does.
needed as (
  select owner.id
  from owner
  where not exists (
    select 1
    from public.memberships m
    where m.user_id = owner.id
      and m.role = 'owner'
      and m.branch_id is null
  )
),
org as (
  -- No `owner_id`. That column was dropped by card 0033: ownership had two spellings, and the one
  -- every policy reads is `memberships.role = 'owner'`, inserted at the bottom of this file. The
  -- `owner` CTE is still needed for exactly that grant.
  insert into public.organizations (name)
  select 'Belas Group' from needed
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
select needed.id, org.id, null, 'owner'
from needed, org;

commit;

-- ---------------------------------------------------------------- check it worked

-- Expect: 1 org, 3 businesses, 3 branches, 1 membership with role = owner - and the SAME four
-- numbers however many times this has been run. A second run used to double the first three, and
-- this query would have said so; nobody looked, because nothing made them.
--
-- `pnpm bootstrap:check` is the version that cannot be ignored: it runs the file twice and asserts
-- the second run changed nothing.
select
  (select count(*) from public.organizations) as orgs,
  (select count(*) from public.businesses)    as businesses,
  (select count(*) from public.branches)      as branches,
  (select count(*) from public.memberships where role = 'owner') as owner_grants;
