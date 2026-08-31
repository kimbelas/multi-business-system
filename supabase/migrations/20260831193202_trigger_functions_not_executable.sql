-- The two trigger functions were the only ones left that PUBLIC could execute.
--
-- `20260831172445` revoked EXECUTE from PUBLIC on the seven policy helpers and left
-- `handle_new_user` alone, deliberately, with this reasoning recorded at the time:
--
--   whether PostgreSQL re-checks EXECUTE on a trigger function at fire time or only at creation
--   time decides whether revoking it breaks the only path by which anyone gets an account, and
--   that is a question to answer against a database rather than in a comment.
--
-- It has now been answered against a database. In a rolled-back transaction: a table, a trigger
-- function, a BEFORE INSERT trigger, then EXECUTE revoked from PUBLIC *and* from `authenticated`
-- and `anon` - verified with `has_function_privilege(current_user, ...)` returning false, because
-- the first attempt at this experiment revoked only from PUBLIC and Supabase's default privileges
-- had granted `authenticated` its own. An insert as `authenticated` then succeeded and the
-- trigger had populated the column.
--
--   ANSWER: EXECUTE is not re-checked when the trigger fires.
--
-- So this revoke cannot break signup, and `branches_org_id_derived` keeps deriving `org_id`.
--
-- ## What it buys, stated honestly
--
-- Very little on its own, and it is worth saying so rather than implying otherwise. A trigger
-- function cannot usefully be called directly - PostgreSQL refuses, because there is no trigger
-- context to supply `NEW` - and PostgREST does not expose functions returning `trigger`, so there
-- was no route to `handle_new_user` from the API even while PUBLIC held the privilege.
--
-- It is worth doing anyway for two reasons. `handle_new_user` is SECURITY DEFINER and inserts
-- into `public.profiles`, so it is exactly the shape where "there is no way to call it" is a
-- claim about today's PostgreSQL and today's PostgREST rather than about the grant. And it
-- removes the last inconsistency in a privilege model that is otherwise now uniform: after this,
-- no function in `public` is executable by PUBLIC, which is a sentence with no exceptions to
-- remember.

revoke execute on function public.handle_new_user() from PUBLIC;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

revoke execute on function public.branches_set_org_id() from PUBLIC;
revoke execute on function public.branches_set_org_id() from anon;
revoke execute on function public.branches_set_org_id() from authenticated;

-- `anon` and `authenticated` are revoked explicitly as well as PUBLIC, because Supabase's default
-- privileges on the `public` schema grant those two roles EXECUTE on newly created functions
-- directly. Revoking PUBLIC alone leaves both grants standing - which is the same class of
-- mistake as defect 4 in 20260831172445, one level down: a revoke naming the wrong grantee reads
-- as protection and is not.
