-- `visible_profile_ids()` returned a row containing NULL to an anonymous caller.
--
--   select auth.uid()          -- one row, NULL, when there is no session
--   union
--   select m.user_id from ...  -- no rows
--
-- so the set was `{NULL}` rather than empty. The persona suite caught it as a one-line
-- expectation mismatch - `expected [ null ] to deeply equal []` - and the previous migration's
-- own comment had already written down that this is what the function does, which is the part
-- worth noticing: it was described accurately and then left alone.
--
-- ## Not a leak, and still worth fixing
--
-- The policy is unaffected. `id in (select public.visible_profile_ids())` against `{NULL}`
-- evaluates to NULL, which is not true, so no row matches and an anonymous read of `profiles`
-- returns nothing. Every other helper returns a genuinely empty set because each selects FROM a
-- table; this one is the only bare `select auth.uid()`, which is why it is the only one that
-- behaves this way.
--
-- What makes it worth a migration rather than a change to the test is the shape it leaves for
-- the next caller. A set-returning function whose result is `{NULL}` instead of `{}` answers
-- differently to the three ways a policy might use it:
--
--   id in (select ...)        NULL -> not true    -> denies. Correct today.
--   id not in (select ...)    NULL -> not true    -> denies everything, including yourself.
--   exists (select 1 from ...)  TRUE              -> a row exists, for an anonymous caller.
--
-- The third is the dangerous one: `exists` over this function is true with no session at all,
-- because one row is present and its content is irrelevant to `exists`. Nothing does that today.
-- It is a plausible next edit, it would read as correct, and it would grant on the strength of a
-- NULL - so the fix belongs in the function, where all three readings become safe, rather than
-- in a test that documents the odd one.

create or replace function public.visible_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- The guard is the whole change: no session, no row, so the set is empty rather than {NULL}.
  select auth.uid()
  where auth.uid() is not null
  union
  select m.user_id
  from public.memberships m
  where m.branch_id in (select public.accessible_branch_ids())
$$;

-- `create or replace` keeps the grants that 20260831172445 and 20260831181029 set on this
-- function - PostgreSQL preserves privileges across a replace - so `authenticated` and `anon`
-- keep EXECUTE and PUBLIC stays revoked. Stated because it is the kind of thing that is assumed
-- rather than checked, and the suite asserts both roles either way.
