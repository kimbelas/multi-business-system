-- M1 — the core money schema and the three business extensions.
--
-- Sections 4.1 to 4.4 of the spec, plus the decisions taken on 2026-09-07 that change its shape.
-- Identity (profiles, organizations, businesses, branches, memberships) already exists; this adds
-- everything money touches. RLS for these tables is the migration after this one: nothing here is
-- readable until it lands.
--
-- Five departures from the spec, each with its reason written down. See docs/04-prior-art.md for the
-- survey behind three of them.
--
--   1. laundry_orders.transaction_id is NULLABLE, and the order carries its own payment_mode.
--   2. branches.opening_float exists, and the close records what was expected of it.
--   3. daily_closes records who counted as well as who closed.
--   4. Ticket numbers come from a counter row, not a sequence.
--   5. transactions carries tips as three columns, not one.

begin;

-- ---------------------------------------------------------------------------
-- 4.1 Enums
-- ---------------------------------------------------------------------------

create type transaction_kind as enum ('sale', 'expense', 'refund', 'prepayment');
-- 'prepayment' is money in that is NOT revenue: a package sold before its sessions are delivered.
-- ASC 606-10-55-46 makes it a contract liability derecognised as the service is given, and a
-- fixed-session package is recognised per session rather than over time. No package tables ship here
-- (card 0046 is blocked until shadowing confirms these businesses sell them) - but an enum value is
-- free today and an ALTER TYPE inside a later migration is not, which is the same argument the shift
-- key was decided on.

create type payment_method as enum
  ('cash', 'gcash', 'maya', 'bank_transfer', 'other', 'package', 'account');
-- The last two are tenders that move no money. 'package' redeems a prepayment; 'account' charges a
-- customer tab. Both are inert until those features exist - but they matter to expected cash TODAY,
-- because it filters on payment_method = 'cash', so a non-money tender falls out structurally rather
-- than by a special case somebody has to remember. That is Odoo's is_cash_count filter, and it is
-- why a tab needs no table of its own.

create type laundry_status as enum
  ('received', 'washing', 'drying', 'folding', 'ready', 'claimed', 'cancelled');

create type appointment_status as enum
  ('booked', 'confirmed', 'completed', 'no_show', 'cancelled');

create type notification_status as enum ('pending', 'sent', 'failed', 'cancelled');

create type laundry_payment_mode as enum ('at_intake', 'on_claim');

-- ---------------------------------------------------------------------------
-- Branch configuration: the float, and whether laundry is paid up front
-- ---------------------------------------------------------------------------

alter table public.branches
  add column opening_float numeric(12,2) not null default 0,
  add column laundry_payment_mode laundry_payment_mode not null default 'at_intake';

comment on column public.branches.opening_float is
  'Standing cash the drawer starts the day with. Owner-set; an input to expected cash, never added '
  'to its result. Default 0 means a branch without a float behaves exactly as the spec computes. '
  'NOTE: no surveyed POS holds a float as a standing column - Odoo carries it forward from last '
  'night''s count and Shopify stores an expected opening beside the counted one so it can report an '
  'opening discrepancy, which is cash that moved while nobody was on shift. Confirm at a branch '
  'whether the drawer is reset to a fixed number each morning; if it is carried over, this column is '
  'the wrong shape. See docs/04-prior-art.md section 1.4.';

comment on column public.branches.laundry_payment_mode is
  'Whether this branch takes payment at intake or on collection. Read once at intake and SNAPSHOTTED '
  'onto the order - see laundry_orders.payment_mode for why a check constraint cannot read it here.';

-- ---------------------------------------------------------------------------
-- 4.2 Core tables
-- ---------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  full_name text not null,
  phone text,                       -- E.164 preferred: +639XXXXXXXXX
  notes text,
  last_visit_at timestamptz,
  created_at timestamptz not null default now()
);
create index clients_business_phone_idx on public.clients (business_id, phone);

comment on table public.clients is
  'Scoped to one business, not to the org. The same person using the laundry and the spa is two rows '
  'with two phone numbers to keep current - a known cost, recorded as a field-study line rather than '
  'solved here.';

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  staff_id uuid not null references public.profiles(id),
  client_id uuid references public.clients(id),
  kind transaction_kind not null default 'sale',
  amount numeric(12,2) not null check (amount > 0),
  payment_method payment_method not null default 'cash',
  reference_no text,                -- the GCash / Maya reference
  description text,

  -- Tips are three facts, and one of them cannot be derived from the other two.
  tip_amount numeric(12,2) not null default 0 check (tip_amount >= 0),
  tip_recipient_staff_id uuid references public.profiles(id),
  tip_in_drawer boolean not null default false,

  occurred_at timestamptz not null default now(),
  is_voided boolean not null default false,
  void_reason text,
  voided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),

  constraint tip_has_a_recipient
    check (tip_amount = 0 or tip_recipient_staff_id is not null),
  constraint tip_in_drawer_means_cash
    check (not tip_in_drawer or payment_method = 'cash'),
  constraint void_has_a_reason
    check (not is_voided or (void_reason is not null and voided_by is not null))
);
create index transactions_branch_occurred_idx on public.transactions (branch_id, occurred_at desc);
create index transactions_staff_occurred_idx on public.transactions (staff_id, occurred_at desc);
create index transactions_tip_recipient_idx on public.transactions (tip_recipient_staff_id)
  where tip_amount > 0;

comment on column public.transactions.amount is
  'Service revenue only. The tip is broken out into tip_amount and is NOT included here. Square '
  'contradicts itself on this exact point - Payment.amount_money excludes the tip while '
  'Tender.amount_money includes it - so the convention is stated here rather than assumed. The '
  'drawer sees amount + tip_amount, filtered by the rule on tip_in_drawer.';

comment on column public.transactions.staff_id is
  'Whoever ENTERED the row, which at a spa is the front desk. Never assume it is who performed the '
  'service or who the tip belongs to - that is tip_recipient_staff_id. Square attributes tips to the '
  'payment taker and gets this wrong for exactly this reason.';

comment on column public.transactions.tip_in_drawer is
  'Did the tip physically enter the till? A customer paying 1000 for a 900 service leaves the drawer '
  'expecting 1000 if the change stayed in the till and 900 if it went into a hand, and NO QUERY CAN '
  'TELL YOU WHICH. Whoever enters the sale answers it. Expected cash adds tip_amount only where this '
  'is true - the same rule as Floreant, whose drawer arithmetic never adds cash tips and subtracts '
  'only tips paid out.';

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  staff_id uuid not null references public.profiles(id),
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  -- Was the clock-out recorded by the person, or set for them afterwards? Payroll should see it, and
  -- card 0021 puts it in the CSV.
  auto_closed boolean not null default false,
  closed_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now(),
  constraint out_after_in check (clock_out is null or clock_out > clock_in),
  constraint auto_closed_needs_an_end check (not auto_closed or clock_out is not null)
);
create index attendance_branch_clockin_idx on public.attendance (branch_id, clock_in desc);

-- One open shift per person. The index STAYS: a clock-in closes whatever the person already has
-- open, marks it auto_closed and surfaces it to a manager, so the morning clock-in works and one
-- person still cannot hold two open shifts. Dropping the index would have been the cheap change and
-- would have reintroduced the duplicate-hours dispute it exists to prevent.
create unique index one_open_shift on public.attendance (staff_id)
  where clock_out is null;

create table public.daily_closes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  close_date date not null,

  -- What the drawer started with, snapshotted from the branch at close time. Stored rather than
  -- read back through the branch, so recomputing an old close cannot silently change when somebody
  -- edits the float.
  opening_float numeric(12,2) not null,

  expected_cash numeric(12,2) not null,   -- computed server-side, AFTER declared_cash is submitted
  declared_cash numeric(12,2) not null,   -- what was counted in the drawer
  variance numeric(12,2) generated always as (declared_cash - expected_cash) stored,
  notes text,

  -- Two people, because the paper form this replaces has two signatures. Square will not call a
  -- drawer CLOSED until an audit by a different person; Toast puts an approver on every cash entry.
  -- counted_by is who counted; closed_by is who submitted. They are usually but not always the same.
  counted_by uuid not null references public.profiles(id),
  counted_at timestamptz not null default now(),
  closed_by uuid not null references public.profiles(id),

  created_at timestamptz not null default now(),

  -- One close per branch per day. The owner's answer, 2026-09-01: no branch counts the drawer twice.
  unique (branch_id, close_date)
);
create index daily_closes_branch_date_idx on public.daily_closes (branch_id, close_date desc);

comment on column public.daily_closes.variance is
  'Stored rather than computed, and the reason is that it is sorted on: the owner''s screen orders '
  'branches by absolute variance, largest first. Shopify materialised the same field for the same '
  'reason. No threshold and no colour band ships until two weeks of real closes exist - which is '
  'also what the category does; only Odoo has a variance threshold at all.';

-- ---------------------------------------------------------------------------
-- Ticket numbers: a counter row, because a sequence cannot be gapless
-- ---------------------------------------------------------------------------
--
-- Postgres is explicit that "sequence objects cannot be used to obtain gapless sequences" - nextval
-- is not reclaimed when a transaction aborts. A counter row incremented inside the order's own
-- transaction rolls back with it, which is what this card asked for.
--
-- period_key is the reset rule, and it is a key rather than a scheduled job - Frappe's idea, whose
-- tabSeries is keyed by the interpolated prefix so a new counter row simply appears each year at 1.
-- '' never resets. to_char(now() at time zone 'Asia/Manila','YYYY') resets yearly. Deriving it in
-- Manila rather than UTC is load-bearing: a UTC key would roll the counter at 08:00 local.

create table public.branch_ticket_counter (
  branch_id  uuid   not null references public.branches(id) on delete cascade,
  period_key text   not null default '',
  next_value bigint not null default 1,
  primary key (branch_id, period_key)
);

create or replace function public.next_ticket_seq(p_branch uuid, p_period text default '')
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.branch_ticket_counter (branch_id, period_key, next_value)
  values (p_branch, p_period, 2)
  on conflict (branch_id, period_key)
  do update set next_value = public.branch_ticket_counter.next_value + 1
  returning next_value - 1;
$$;

comment on function public.next_ticket_seq(uuid, text) is
  'Allocate the next ticket number for a branch. One statement, so there is no separate SELECT FOR '
  'UPDATE and no race on a branch''s first ever order: the insert path returns 2-1 = 1 and the '
  'conflict path returns (old+1)-1 = old. Takes a ROW lock, so two orders at one branch serialise '
  'and different branches never block each other. Call it as late as possible in the transaction - '
  'the branch is serialised from here to commit, so never allocate and then call an SMS provider.';

alter table public.branch_ticket_counter enable row level security;
-- Deliberately no policies. Only the definer function touches this table; a client that could read
-- it could also learn how many orders a branch has taken.
revoke all on function public.next_ticket_seq(uuid, text) from public;
grant execute on function public.next_ticket_seq(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4.3 Extension tables
-- ---------------------------------------------------------------------------

create table public.laundry_orders (
  id uuid primary key default gen_random_uuid(),

  -- NULLABLE, unlike the spec. Every surveyed system points payment -> order and none puts a
  -- mandatory payment id on an order; the one laundry POS that keeps payment state on the order
  -- reduces it to a boolean and thereby cannot say which day's drawer the money belongs in.
  transaction_id uuid unique references public.transactions(id),

  -- Snapshotted from the branch at intake, NOT read back through it. A check constraint cannot see
  -- the branch row, and a branch will change modes with orders still open - the registered risk names
  -- "an order taken in one mode and claimed after the branch switched" as the case that will occur.
  payment_mode laundry_payment_mode not null,

  branch_id uuid not null references public.branches(id),
  client_id uuid references public.clients(id),

  -- The number, and the string. ticket_seq is allocated from branch_ticket_counter and is what
  -- uniqueness is enforced on; ticket_no is how it is shown, formatted from branch configuration.
  ticket_seq bigint not null,
  ticket_no text not null,

  -- Captured at intake so an order can be found without the stub. The documented PH policy is a
  -- government ID first, but name and phone are what a shop actually searches by - and the one
  -- vendor offering only date filters ships a "Can't find an order" support article.
  contact_phone text,

  weight_kg numeric(6,2) check (weight_kg is null or weight_kg > 0),
  items_note text,
  status laundry_status not null default 'received',
  ready_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint paid_at_intake_has_a_transaction
    check (payment_mode = 'on_claim' or transaction_id is not null),
  constraint claimed_orders_are_paid
    check (status <> 'claimed' or transaction_id is not null),

  unique (branch_id, ticket_seq),
  unique (branch_id, ticket_no)
);
create index laundry_orders_branch_status_idx on public.laundry_orders (branch_id, status);
create index laundry_orders_phone_idx on public.laundry_orders (branch_id, contact_phone)
  where contact_phone is not null;
-- Finding a stuck order without going looking for one: the board sorts on this.
create index laundry_orders_open_idx on public.laundry_orders (branch_id, created_at)
  where status not in ('claimed', 'cancelled');

comment on constraint claimed_orders_are_paid on public.laundry_orders is
  'An order cannot be handed over unpaid. This is the half of pay-on-claim that the nullable column '
  'gives away, put back explicitly: unpaid is a state an order passes through, not one it ends in.';

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (branch_id, name)
);

comment on table public.rooms is
  'Unused in v1 by decision: the therapist is enough, no rooms admin ships, and a branch with no '
  'rooms books normally. Rooms become real when a branch says two therapists are competing for one.';

create extension if not exists btree_gist;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  client_id uuid not null references public.clients(id),
  staff_id uuid references public.profiles(id),   -- the therapist or aesthetician
  room_id uuid references public.rooms(id),
  service_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status appointment_status not null default 'booked',
  transaction_id uuid references public.transactions(id),  -- set on completion
  created_at timestamptz not null default now(),
  constraint ends_after_starts check (ends_at > starts_at)
);
create index appointments_branch_starts_idx on public.appointments (branch_id, starts_at);

-- Therapist and room are both resources, and a live booking may not overlap on either.
alter table public.appointments add constraint no_staff_overlap
  exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (staff_id is not null and status in ('booked', 'confirmed'));

alter table public.appointments add constraint no_room_overlap
  exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (room_id is not null and status in ('booked', 'confirmed'));

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  qty numeric(10,2) not null default 0,
  unit text not null default 'pc',
  low_stock_threshold numeric(10,2) not null default 0,
  expires_at date,
  created_at timestamptz not null default now()
);
create index stock_items_branch_idx on public.stock_items (branch_id);

-- ---------------------------------------------------------------------------
-- 4.4 Shared infrastructure
-- ---------------------------------------------------------------------------

create table public.notifications_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid references public.clients(id),
  phone text not null,
  template_key text not null,       -- 'laundry_ready' | 'appt_reminder' | 'rebooking_nudge'
  payload jsonb not null default '{}'::jsonb,
  send_at timestamptz not null default now(),
  status notification_status not null default 'pending',
  attempts int not null default 0,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index outbox_due on public.notifications_outbox (send_at)
  where status = 'pending';
-- The failure side has to be as easy to find as the queue, or nobody will look at it.
create index outbox_failed on public.notifications_outbox (business_id, created_at desc)
  where status = 'failed';

commit;
