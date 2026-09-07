-- M1, part two — row-level security for everything the money schema added.
--
-- Section 5.2 of the spec. The identity tables already carry their own policies from
-- 20260831081929_identity_rls.sql and the hardening after it; this covers only the nine tables the
-- previous migration created. Until now every one of them has been readable by nobody, because a
-- table with RLS enabled and no policy denies everything - which is the right default and the
-- reason this lands in the same session rather than the next one.
--
-- The load-bearing asymmetry, and the reason this file exists at all: **staff may not read branch
-- totals.** A staff member sees the transactions they entered, so they can reprint a ticket, and
-- nothing else. They never see a close. That is the whole cash-leakage story in two policies.

begin;

alter table public.clients enable row level security;
alter table public.transactions enable row level security;
alter table public.attendance enable row level security;
alter table public.daily_closes enable row level security;
alter table public.laundry_orders enable row level security;
alter table public.rooms enable row level security;
alter table public.appointments enable row level security;
alter table public.stock_items enable row level security;
alter table public.notifications_outbox enable row level security;

-- ---------------------------------------------------------------------------
-- A branch member's business ids, said once
-- ---------------------------------------------------------------------------

create or replace function public.accessible_business_ids_via_branches()
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

comment on function public.accessible_business_ids_via_branches() is
  'The businesses a person can reach through a branch grant. Separate from '
  'accessible_business_ids(), which answers the same question for the shell; this one is written '
  'for policies and is stable + security definer so the planner can inline it and so a policy on '
  'branches cannot recurse into itself. Getting that wrong here once produced a 42P17.';

-- ---------------------------------------------------------------------------
-- clients — anyone with a branch of that business
-- ---------------------------------------------------------------------------

create policy clients_rw on public.clients for all
  using (business_id in (select public.accessible_business_ids_via_branches()))
  with check (business_id in (select public.accessible_business_ids_via_branches()));

-- ---------------------------------------------------------------------------
-- transactions — the sensitive table
-- ---------------------------------------------------------------------------

-- Anyone at the branch may record a sale, and only as themselves. `staff_id = auth.uid()` is what
-- makes "every peso is attributed to a person" true rather than aspirational: a staff member cannot
-- enter a sale under somebody else's name even by crafting the request.
create policy tx_insert on public.transactions for insert with check (
  branch_id in (select public.accessible_branch_ids())
  and staff_id = auth.uid()
);

-- Managers and owners see the branch. Staff see only their own rows - enough to reprint what they
-- just took, never enough to total the day.
create policy tx_select on public.transactions for select using (
  public.role_for_branch(branch_id) in ('owner', 'manager')
  or (public.role_for_branch(branch_id) = 'staff' and staff_id = auth.uid())
);

-- Update is for voiding, and the trigger below decides what a void may touch.
create policy tx_void on public.transactions for update
  using (public.role_for_branch(branch_id) in ('owner', 'manager'))
  with check (public.role_for_branch(branch_id) in ('owner', 'manager'));

-- No delete policy, deliberately: nobody deletes a transaction, ever. The audit trail is the
-- product.

create or replace function public.protect_transaction_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.amount is distinct from old.amount
     or new.kind is distinct from old.kind
     or new.payment_method is distinct from old.payment_method
     or new.occurred_at is distinct from old.occurred_at
     or new.staff_id is distinct from old.staff_id
     or new.branch_id is distinct from old.branch_id
     or new.tip_amount is distinct from old.tip_amount
     or new.tip_in_drawer is distinct from old.tip_in_drawer
     or new.tip_recipient_staff_id is distinct from old.tip_recipient_staff_id then
    raise exception 'transactions are immutable; void and re-enter instead';
  end if;

  if old.is_voided and not new.is_voided then
    raise exception 'voids cannot be reversed';
  end if;

  if new.is_voided and not old.is_voided then
    new.voided_by := auth.uid();
    if new.void_reason is null or length(trim(new.void_reason)) < 3 then
      raise exception 'void_reason is required';
    end if;
  end if;

  return new;
end $$;

comment on function public.protect_transaction_fields() is
  '`is distinct from`, not `<>`. A null on either side makes `<>` null, which is not true, so the '
  'guard would pass - and every tip column is nullable or defaulted. The spec''s version used `<>` '
  'and would have let a manager silently move a tip to themselves.';

create trigger protect_tx before update on public.transactions
  for each row execute function public.protect_transaction_fields();

-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------

create policy att_insert on public.attendance for insert with check (
  branch_id in (select public.accessible_branch_ids())
  and staff_id = auth.uid()
);

-- A person may close their own open shift. This is also what a clock-in uses to auto-close the
-- shift they left open yesterday.
create policy att_update_own_open on public.attendance for update
  using (staff_id = auth.uid() and clock_out is null)
  with check (staff_id = auth.uid());

-- And a manager may fix one that was left open, which is the answer to the forgotten clock-out:
-- somebody with authority sets the end time, and `auto_closed` records that it was set after the
-- fact rather than by the person.
create policy att_update_manager on public.attendance for update
  using (public.role_for_branch(branch_id) in ('owner', 'manager'))
  with check (public.role_for_branch(branch_id) in ('owner', 'manager'));

create policy att_select on public.attendance for select using (
  public.role_for_branch(branch_id) in ('owner', 'manager')
  or staff_id = auth.uid()
);

-- ---------------------------------------------------------------------------
-- daily_closes — managers and owners, both directions
-- ---------------------------------------------------------------------------
--
-- Staff have no policy here at all, which is the point: a staff member cannot read the close, so
-- they cannot learn what the drawer was expected to hold by reading yesterday's. The blind close is
-- a property of the data path in the app; this is the floor under it.

create policy close_read on public.daily_closes for select
  using (public.role_for_branch(branch_id) in ('owner', 'manager'));

create policy close_insert on public.daily_closes for insert
  with check (
    public.role_for_branch(branch_id) in ('owner', 'manager')
    and closed_by = auth.uid()
  );

-- No update and no delete policy. A submitted count is not editable by anyone - that is the
-- property the whole control depends on, and the surest way to have it is for there to be no route.

-- ---------------------------------------------------------------------------
-- laundry_orders — every branch member, because staff move the statuses
-- ---------------------------------------------------------------------------

create policy laundry_rw on public.laundry_orders for all
  using (branch_id in (select public.accessible_branch_ids()))
  with check (branch_id in (select public.accessible_branch_ids()));

-- Forward-only, enforced here rather than only in a server action, because "the status is never
-- ambiguous" is a claim about the data and not about one code path.
create or replace function public.protect_laundry_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  order_of constant text[] :=
    array['received', 'washing', 'drying', 'folding', 'ready', 'claimed'];
  old_pos int;
  new_pos int;
begin
  if new.status = old.status then
    return new;
  end if;

  -- Cancelling is the one move that is not forward, and it belongs to a manager.
  if new.status = 'cancelled' then
    if old.status in ('claimed', 'cancelled') then
      raise exception 'a % order cannot be cancelled', old.status;
    end if;
    if public.role_for_branch(new.branch_id) not in ('owner', 'manager') then
      raise exception 'only a manager or owner may cancel an order';
    end if;
    return new;
  end if;

  if old.status = 'cancelled' then
    raise exception 'a cancelled order cannot be reopened';
  end if;

  old_pos := array_position(order_of, old.status::text);
  new_pos := array_position(order_of, new.status::text);
  if new_pos <= old_pos then
    raise exception 'laundry status only moves forward: % cannot go back to %',
      old.status, new.status;
  end if;

  -- The two timestamps are recorded rather than typed, so "when did it become ready" is not a
  -- field somebody can be wrong about.
  if new.status = 'ready' and new.ready_at is null then
    new.ready_at := now();
  end if;
  if new.status = 'claimed' and new.claimed_at is null then
    new.claimed_at := now();
  end if;

  return new;
end $$;

create trigger protect_laundry_status before update on public.laundry_orders
  for each row execute function public.protect_laundry_status();

-- ---------------------------------------------------------------------------
-- rooms, appointments, stock_items — the same branch-scoped pattern
-- ---------------------------------------------------------------------------

create policy rooms_rw on public.rooms for all
  using (branch_id in (select public.accessible_branch_ids()))
  with check (branch_id in (select public.accessible_branch_ids()));

create policy appointments_rw on public.appointments for all
  using (branch_id in (select public.accessible_branch_ids()))
  with check (branch_id in (select public.accessible_branch_ids()));

create policy stock_rw on public.stock_items for all
  using (branch_id in (select public.accessible_branch_ids()))
  with check (branch_id in (select public.accessible_branch_ids()));

-- ---------------------------------------------------------------------------
-- notifications_outbox — members queue and read; only the service role sends
-- ---------------------------------------------------------------------------

create policy outbox_insert on public.notifications_outbox for insert
  with check (business_id in (select public.accessible_business_ids_via_branches()));

create policy outbox_read on public.notifications_outbox for select
  using (business_id in (select public.accessible_business_ids_via_branches()));

-- No update policy. Marking a message sent or failed is the cron route's job, and it holds the
-- service role key, which bypasses RLS by design. A client that could set `status = 'sent'` could
-- make the failure side of the outbox disappear, which is the one thing it exists to show.

commit;
