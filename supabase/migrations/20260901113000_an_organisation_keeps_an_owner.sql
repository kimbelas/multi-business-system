-- An organisation can never be left with no owner. Card 0034.
--
-- This is the guard that makes granting owner safe to build. Until now the app could not create an
-- owner grant, so it could not remove one either - `revokeGrant` refused every owner row and the
-- roster showed no controls on them. Making removal possible without this would make the app able to
-- reach the one state it cannot recover from.
--
-- ## Why zero owners is unrecoverable rather than merely bad
--
-- `owned_org_ids()` is the root of `accessible_branch_ids`, `role_for_branch`, `owned_business_ids`,
-- the owner arm of `visible_profile_ids`, `signed_in_members`, `may_reissue_password` and every
-- `_owner_all` policy. With no owner row that set is empty for everybody: the roster cannot be read,
-- `/settings` is a 404 for all three roles, and `inviteStaff` cannot grant because
-- `membership_owner_all`'s `with check` fails. The person who was the owner an hour ago is now
-- indistinguishable from a stranger, and putting it back takes the service-role key or psql. That is
-- the situation card 0019 existed to end, arrived at permanently, on the screen built to end it.
--
-- ## Why this cannot live in the server action
--
-- Two reasons, and the second is the decisive one.
--
-- It races: `revokeGrant` reads the row and deletes it in two PostgREST requests, so two
-- transactions with no lock between them. Two owners removing each other concurrently each count two
-- owners and both proceed.
--
-- And the app is not PostgREST's only client. `membership_owner_all` is `for all`, so an owner
-- holding a real session can send `DELETE /rest/v1/memberships?org_id=eq.X&role=eq.owner` with the
-- public anon key and take every owner row out in one statement that no server action ever sees.
-- This project's own rule is that RLS is the only authorization layer and the UI merely hides what a
-- role cannot do; that rule applies to an invariant exactly as it applies to a read.
--
-- ## Why a trigger, in a codebase that prefers declarative enforcement
--
-- The invariant is about a SET of rows - "an org that has an owner never drops to none" - which a
-- `check` constraint cannot see and a policy cannot express: a policy filters rows, it does not
-- assert a post-condition. The composite foreign key in 20260831172445 was chosen over a trigger
-- precisely because a declarative form existed there. There is none here.
--
-- ## Why it counts rows instead of comparing identities
--
-- The first version of `revokeGrant` refused "my own org-wide owner row", which was neither
-- necessary nor sufficient: it permitted removing ANOTHER owner and refused removing a harmless
-- duplicate. The question is how many owner rows remain, whoever they belong to.
--
-- ## Why UPDATE as well as DELETE
--
-- Demoting the last owner is the same hole spelled differently - `update memberships set role =
-- 'manager', branch_id = <a branch>` leaves no owner and deletes nothing. Moving the row to another
-- organisation is the third spelling. INSERT is deliberately absent: an insert cannot reduce the
-- count.

create or replace function public.assert_org_keeps_an_owner()
returns trigger
language plpgsql
security definer          -- counts every owner row, not the ones RLS shows this particular caller
set search_path = ''      -- 20260831172445's rule, no exceptions, everything schema-qualified
as $$
declare
  remaining integer;
begin
  /*
   * Arm one: an organisation that no longer exists cannot be orphaned.
   *
   * This is what lets `delete from organizations` cascade its memberships away, and both test
   * teardowns depend on that. Without it the guard protecting the owner also makes every
   * organisation undeletable, `tests-e2e/auth.teardown.ts` collects the failure and asserts there
   * are none, and the suite goes red on every run - at which point somebody deletes the guard.
   *
   * Note what this is NOT: "every organisation has an owner". Both fixture organisations
   * legitimately have zero memberships for a while, and `bootstrap-owner.sql` creates the org before
   * the grant. The invariant is narrower and true.
   *
   * Verified rather than assumed: `on delete cascade` runs the child delete from an AFTER trigger on
   * the parent, and this AFTER ROW trigger's own query takes a fresh snapshot in which the parent is
   * already gone. Checked against the real database with two experiments before this shipped.
   */
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return null;
  end if;

  /*
   * Arm two: serialize on the ORGANISATION row, then count.
   *
   * The lock is the substance of this function. Without it the count is a snapshot read and two
   * concurrent removals each see the other's row still present, so both commit and the org ends with
   * no owner - textbook write skew.
   *
   * The organisation row rather than the owner rows, and that choice matters. `for update` over the
   * owner rows deadlocks: two transactions each deleting a DIFFERENT owner row already hold a row
   * lock on their own target and then each want the other's, so Postgres aborts one with 40P01
   * instead of 23001 - the invariant survives but the error is a lock failure rather than an
   * explanation, and any test asserting the sqlstate becomes a coin flip. One row per organisation
   * is a single deterministic point: the second transaction blocks immediately, and there is no cycle
   * to detect.
   *
   * `for no key update` rather than `for update` because it does not conflict with the `for key
   * share` that an ordinary membership INSERT takes on this same organisation row. It is
   * self-conflicting, which is all this needs. `for update` would make every insert into a busy
   * organisation queue behind an unrelated owner removal.
   *
   * The count is a separate statement because an aggregate cannot carry FOR UPDATE. Each statement
   * in a volatile plpgsql function takes a fresh snapshot under READ COMMITTED, which is exactly
   * what makes the pair correct: by the time this runs, the transaction we waited for has committed
   * and its deletion is visible.
   */
  perform 1
  from public.organizations o
  where o.id = old.org_id
  for no key update;

  select count(*) into remaining
  from public.memberships m
  where m.org_id = old.org_id
    and m.role = 'owner'::public.member_role;

  if remaining = 0 then
    /*
     * 23001 restrict_violation, so `revokeGrant` can recognise it and say something a person can
     * read instead of forwarding a sentence that names a uuid and a trigger. PostgREST returns the
     * sqlstate as `code`.
     */
    raise exception 'an organisation cannot be left with no owner'
      using errcode = 'restrict_violation',
            detail  = format('organization %s', old.org_id),
            hint    = 'Grant owner to somebody else first, then remove this one.';
  end if;

  return null;
end;
$$;

-- 20260831193202's rule, in full and for its stated reason. `create function` grants EXECUTE to
-- PUBLIC, and Supabase's default privileges additionally grant `anon` and `authenticated` directly -
-- so a revoke naming only PUBLIC reads as protection and is not. EXECUTE is not re-checked when a
-- trigger fires, which is why revoking cannot break the trigger; that question was answered against
-- a database rather than in a comment.
revoke execute on function public.assert_org_keeps_an_owner() from PUBLIC;
revoke execute on function public.assert_org_keeps_an_owner() from anon;
revoke execute on function public.assert_org_keeps_an_owner() from authenticated;

-- Two triggers, one function: a DELETE trigger's WHEN clause cannot mention `new`, so the condition
-- cannot be shared. The WHEN clauses keep this off the hot path - removing a staff grant, which is
-- the ordinary case, never enters the function at all.
create trigger memberships_keep_an_owner_on_delete
after delete on public.memberships
for each row
when (old.role = 'owner'::public.member_role)
execute function public.assert_org_keeps_an_owner();

create trigger memberships_keep_an_owner_on_update
after update on public.memberships
for each row
when (
  old.role = 'owner'::public.member_role
  and (new.role is distinct from old.role or new.org_id is distinct from old.org_id)
)
execute function public.assert_org_keeps_an_owner();

-- ---------------------------------------------------------------- one owner row per person per org
--
-- `unique (user_id, org_id, branch_id)` uses the default NULLS DISTINCT, so two identical org-wide
-- owner rows for the same person are legal. `revokeGrant` already recorded that as something only
-- SQL could clear - and it was unreachable while nothing in the app could create an owner grant.
-- `grantOwner` makes it one double click away.
--
-- It also decides whether counting rows is a correct way to ask "does this org still have an owner".
-- With duplicates allowed, two owner rows can mean one person, and a count-based guard would happily
-- let their real access go while a duplicate satisfied it. The index is what makes the count sound.
--
-- `where branch_id is null` is exactly the owner case: `staff_needs_branch` already forbids a null
-- branch for every other role. Additive rather than replacing the existing key with NULLS NOT
-- DISTINCT, so the constraint every other grant relies on is untouched.
create unique index memberships_one_org_wide_grant_per_person
on public.memberships (user_id, org_id)
where branch_id is null;
