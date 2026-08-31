-- Two regressions from 20260831172445, both caught by the persona suite on its first real run.
--
-- Worth recording that the suite paid for itself immediately: the run that verified the four
-- fixes also found two things the fixes broke, one of them on the owner's landing screen. Both
-- were invisible to typecheck, lint and the 96 hermetic unit tests.
--
-- ## 1. A second foreign key made the businesses -> branches embed ambiguous
--
--   Could not embed because more than one relationship was found for 'businesses' and 'branches'
--
-- `src/lib/scope.ts` runs `select("id, name, type, branches (id, name, is_active)")` on every
-- request in the `(app)` layout, and PostgREST resolves an embed by finding *the* foreign key
-- between the two tables. Adding `branches_business_org_fk` alongside the original
-- `branches_business_id_fkey` gave it two, so it refused to choose - and the screen that broke
-- is the same one 42P17 broke, which is why the regression test for that recursion is what
-- caught this.
--
-- The two keys are redundant rather than complementary: the composite covers `business_id` as
-- its first column, so everything the single-column key enforced, it enforces. Dropping the
-- narrower one leaves exactly one relationship and loses no guarantee. Same reasoning for
-- `memberships_branch_id_fkey`, which nothing embeds today - fixing it now rather than leaving
-- the identical landmine for the first query that tries.
--
-- ## 2. Revoking EXECUTE from anon turned a quiet empty read into an error
--
--   permission denied for function visible_profile_ids (42501)
--
-- `anon, with no session at all > reads nothing from any table` asserts that an unauthenticated
-- read returns `[]` and no error, on every table. Once the policies call helper functions and
-- `anon` cannot execute them, evaluating the policy fails instead of matching no rows, so all
-- five tables started answering 42501.
--
-- ### The guard was protecting nothing
--
-- The original rationale - "these read across the whole membership table by design, so `anon`
-- holding execute would be a way to enumerate it with no login at all" - does not survive
-- reading the functions. Every one of them is scoped by `auth.uid()`, which is null without a
-- session:
--
--   owned_org_ids          where user_id = auth.uid()            -> no rows
--   accessible_branch_ids  both arms via auth.uid()              -> no rows
--   owned_business_ids     via owned_org_ids()                   -> no rows
--   accessible_business_ids via accessible_branch_ids()          -> no rows
--   member_org_ids         where user_id = auth.uid()            -> no rows
--   visible_profile_ids    select auth.uid() -> one null row, and `id in (null)` is never true
--   role_for_branch(uuid)  exists() false, then auth.uid() match -> null, for any branch id
--
-- So an anon caller learns nothing from any of them. There is no enumeration to prevent.
--
-- ### And it never actually applied
--
-- More to the point, `revoke ... from anon` never removed the privilege in the first place -
-- `create function` grants EXECUTE to PUBLIC and revoking from `anon` leaves that in place,
-- which is defect 4 of the previous migration. So on `main`, `anon` *could* execute all of
-- these, and the tables still read quietly empty. Granting `anon` EXECUTE explicitly here is
-- therefore not a loosening: it is the behaviour `main` already had, spelled so that it is true
-- on purpose rather than by an ineffective revoke, and the PUBLIC grant stays revoked so the
-- privilege belongs to two named roles instead of every role that will ever exist.
--
-- The test changes with it, from asserting an error to asserting the property that actually
-- matters: a call with no session returns nothing. That is a stronger claim than "the call is
-- refused", because it is about what leaks rather than about who may knock.
--
-- ### The stronger option, not taken here
--
-- Putting these helpers in a schema PostgREST does not expose would make "not callable without
-- a session" literally true - not callable through the API by anyone, while policies keep
-- working, because schema exposure and database privileges are different things. That is the
-- better end state and it is a larger change: a new schema, all eight policies rewritten, and
-- the RPC-based tests replaced with "not reachable at all". Left as a follow-up rather than
-- folded into a fix for a regression.

-- ---------------------------------------------------------------- 1. one relationship each

-- The composite key's first column is `business_id`, so this drops nothing that is not still
-- enforced by `branches_business_org_fk`.
alter table public.branches
  drop constraint branches_business_id_fkey;

-- Same: `memberships_branch_in_org_fk` leads with `branch_id`. Under MATCH SIMPLE a null
-- `branch_id` skips the check, which is the owner case and is what the single-column key
-- permitted too.
alter table public.memberships
  drop constraint memberships_branch_id_fkey;

-- The dropped keys had no index behind them, and a cascade from `businesses` now looks up this
-- pair rather than `business_id` alone.
create index branches_business_org_idx on public.branches (business_id, org_id);

-- ---------------------------------------------------------------- 2. anon may evaluate policies

-- Not a privilege that lets anon read anything - every one of these is scoped by auth.uid(), and
-- the policies they serve deny anon on their own. It is what lets an unauthenticated read match
-- no rows instead of failing to evaluate.
grant execute on function
  public.owned_org_ids(),
  public.accessible_branch_ids(),
  public.role_for_branch(uuid),
  public.owned_business_ids(),
  public.accessible_business_ids(),
  public.visible_profile_ids(),
  public.member_org_ids()
to anon;
