-- Which of an organisation's people have ever signed in.
--
-- Card 0019: "An invited person who has never signed in is visibly distinct from one who has, so an
-- unused invitation is findable." Nothing in `public` knows that. `auth.users.last_sign_in_at` does,
-- and it belongs to Supabase rather than to us.
--
-- ## Why a function and not the service role
--
-- The obvious alternative is to read it with `createAdminClient` on the settings render. That
-- client is documented as doing *exactly one thing in v1* - inviting staff - and it bypasses RLS
-- entirely. Giving it a second job, on a page render, is how a service-role key stops being
-- auditable: the question "what runs as service role" stops having a short answer.
--
-- The other alternative is an invitations table, which is the pattern the research describes and
-- the right one in general - the role belongs to the invitation and is applied when the membership
-- is created, which is a security boundary rather than a convenience. It is wrong *here* because
-- our invite creates the auth user and the membership in a single step, so the row would describe a
-- state that exists for the length of one transaction.
--
-- So: one `security definer` function that answers one question, scoped to organisations the caller
-- owns. It is the pattern the identity layer already uses for every cross-table read.
--
-- ## Set-returning, not per-person
--
-- A `has_signed_in(uuid)` predicate would be one round trip per row on a screen whose whole job is
-- to list people. This returns the ids that HAVE signed in, once, and the caller treats absence as
-- "invited, not yet here".
--
-- The org check is inside the function rather than left to the caller: a definer function runs as
-- its owner, so an unscoped version would answer for any organisation to anyone who could call it.
-- `owned_org_ids()` is the same gate `membership_owner_all` uses, so this leaks nothing an owner
-- could not already establish - they can already list every grant in their org.

create or replace function public.signed_in_members(target_org uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.org_id = target_org
    and target_org in (select public.owned_org_ids())
    and u.last_sign_in_at is not null
$$;

-- Same shape as every other helper: PUBLIC is the grant `create function` actually makes, so it is
-- the one that has to be revoked. Not granted to `anon` - unlike the policy helpers, nothing
-- evaluates this during an anonymous read, so there is no quiet-empty behaviour to preserve.
revoke execute on function public.signed_in_members(uuid) from PUBLIC;
revoke execute on function public.signed_in_members(uuid) from anon;
grant execute on function public.signed_in_members(uuid) to authenticated;
