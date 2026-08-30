# Multi-Business Management System — Technical Specification

> **Audience:** Claude Code. This document is the single source of truth for building the system. Follow it top to bottom; each milestone in §14 is a self-contained unit of work. When this spec and an ad-hoc instruction conflict, ask before proceeding.
>
> **Project codename:** `bizdesk` (rename freely — nothing depends on it).

---

## 1. Project Overview

A single web application that lets one owner manage three small businesses in the Philippines — a **laundry shop**, a **massage/spa**, and a **skin care clinic** — each with one or more branches and employed staff. The owner cannot be physically present at every branch; the system's core job is **visibility and accountability**: what was sold, by whom, at which branch, and does the declared cash match.

### Problems this system solves (research-validated)

| #   | Problem                                                                            | Feature that solves it                                             |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| P1  | Cash leakage / underreported sales across branches the owner can't watch           | Transaction log with staff attribution + daily close with variance |
| P2  | No centralized view of multi-branch performance                                    | Owner dashboard (mobile-first)                                     |
| P3  | Laundry orders lost, mixed up, or stuck in limbo ("washed but never marked ready") | Ticketed order lifecycle with status tracking                      |
| P4  | Spa no-shows and forgotten appointments                                            | SMS reminder pipeline (v1: outbox + reminders; v2: full booking)   |
| P5  | Skin care clients silently never rebooking                                         | Client records + "due for follow-up" list + rebooking SMS          |
| P6  | Manual notebook/Excel records — errors, no audit trail                             | 30-second digital entry flows, immutable audit fields              |
| P7  | Attendance disputes                                                                | Clock in/out per branch                                            |

### Explicit non-goals (do NOT build)

- **Payroll.** PH payroll (SSS, PhilHealth, Pag-IBIG, 13th month, withholding tax) is out of scope. Attendance data must be **exportable to CSV** so whoever does payroll today can consume it.
- **BIR-compliant official receipts.** The system prints/sends _acknowledgment slips_ and _order tickets_ only. Never label any output "Official Receipt" or "OR".
- **Offline mode** in v1. Design data entry to be retry-friendly (idempotent server actions), but no service-worker sync.
- **Payment processing.** The system records that a GCash/Maya/cash payment happened (with reference number); it never moves money.
- **Granular permission-matrix RBAC.** Three coarse roles only (§7).

---

## 2. Tech Stack

| Layer           | Choice                                                                     | Notes                                                                                   |
| --------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Framework       | **Next.js (App Router)**, TypeScript `strict: true`                        | React Server Components by default; Client Components only where interactivity requires |
| Styling         | **Tailwind CSS**                                                           | Mobile-first; the owner uses a phone                                                    |
| UI primitives   | **shadcn/ui**                                                              | Copy-in components; keeps the Worker bundle lean                                        |
| Backend         | **Supabase** — Postgres, Auth, Row Level Security                          | RLS is the _only_ authorization enforcement layer                                       |
| Validation      | **zod**                                                                    | Every server action input and every API boundary                                        |
| Hosting         | **Cloudflare Workers** via **`@opennextjs/cloudflare`** (OpenNext adapter) | Node.js runtime. NOT `@cloudflare/next-on-pages` (legacy, Edge-runtime only)            |
| Scheduled jobs  | **Cloudflare Cron Trigger** → `/api/cron/notifications`                    | Protected by `CRON_SECRET` header check                                                 |
| SMS             | Provider abstraction with a **Semaphore** driver (PH-local)                | Twilio driver optional later; see §10                                                   |
| Testing         | **Vitest** (unit) + **Playwright** (e2e, critical flows only)              | See §15                                                                                 |
| Package manager | **pnpm**                                                                   |                                                                                         |

### Stack constraints to respect

- **Worker size:** Cloudflare Workers free plan enforces a **3 MiB compressed** limit per Worker. Audit bundle size at every milestone (`pnpm build && npx opennextjs-cloudflare build` prints sizes). Prefer copy-in components (shadcn) over heavy component libraries. No moment.js, no lodash (use `es-toolkit` or native), charts via a single lightweight lib (`recharts` acceptable, verify size; else render simple SVG bars).
- **Supabase free tier during development:** 500 MB DB, 2 active projects, auto-pause after 7 days of inactivity. Production launch should move to Pro ($25/mo) for no-pause + daily backups. Until then, add a GitHub Actions scheduled `pg_dump` backup (Milestone 8).
- **`next/image`:** use `images.unoptimized: true` in `next.config` OR a custom Cloudflare Images loader. Default Vercel optimizer will fail on Cloudflare. This app has almost no images, so `unoptimized: true` is fine.
- **Runtime:** keep every route on the Node.js runtime (OpenNext default). Do not add `export const runtime = 'edge'` anywhere.

---

## 3. Architecture — Core + Extensions

One sentence describes what all three businesses share:

> _A staff member at a branch performs a service for a client, and money changes hands at a point in time._

That sentence is the **core schema**. Everything business-specific is an **extension** (satellite table) that references core rows by ID. Extensions never modify core; core never knows extensions exist.

```
                       ┌──────────────┐
                       │ organizations │  (the owner's umbrella)
                       └──────┬───────┘
                              │ 1:N
                       ┌──────┴───────┐
                       │  businesses  │  type: laundry | spa | skincare
                       └──────┬───────┘
                              │ 1:N
        ┌──────────┐   ┌──────┴───────┐   ┌──────────┐
        │ clients  │   │   branches   │   │memberships│ (user ↔ role ↔ scope)
        └────┬─────┘   └──────┬───────┘   └──────────┘
             │                │ 1:N
             │         ┌──────┴────────────────────────────┐
             └────────▶│ transactions │ attendance │ daily_closes │  CORE
                       └──────┬────────────────────────────┘
                              │ referenced by (never referencing)
              ┌───────────────┼───────────────────┐
        ┌─────┴──────┐  ┌─────┴──────┐  ┌─────────┴────────┐
        │laundry_orders│ │appointments│  │   stock_items    │  EXTENSIONS
        └────────────┘  └────────────┘  └──────────────────┘
                       ┌────────────────────┐
                       │ notifications_outbox│  shared infrastructure
                       └────────────────────┘
```

**Rules that make this reusable:**

1. Extensions reference core by foreign key (`laundry_orders.transaction_id`). The dashboard renders revenue from any business type without importing any extension code.
2. Adding a fourth business type = one extension table + one feature folder. Zero core changes.
3. The notifications outbox is shared infrastructure: laundry "order ready", spa reminders, and skin care rebooking prompts all write rows to the same table with different `template_key`s.
4. In application code, branch on `business.type` only via exhaustive discriminated unions (TypeScript `never` check in the default case).

---

## 4. Database Schema (Supabase migrations)

All migrations live in `supabase/migrations/`. Use `supabase db diff` locally. Every table: `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`. Money is `numeric(12,2)`, never floats. Timestamps are `timestamptz` (store UTC; render Asia/Manila in the UI).

### 4.1 Enums

```sql
create type business_type as enum ('laundry', 'spa', 'skincare');
create type member_role as enum ('owner', 'manager', 'staff');
create type transaction_kind as enum ('sale', 'expense', 'refund');
create type payment_method as enum ('cash', 'gcash', 'maya', 'bank_transfer', 'other');
create type laundry_status as enum
  ('received', 'washing', 'drying', 'folding', 'ready', 'claimed', 'cancelled');
create type appointment_status as enum
  ('booked', 'confirmed', 'completed', 'no_show', 'cancelled');
create type notification_status as enum ('pending', 'sent', 'failed', 'cancelled');
```

### 4.2 Core tables

```sql
-- Mirrors auth.users; created by trigger on signup.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type business_type not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- THE authorization model. One row = one grant.
-- owner:   branch_id NULL  → full access to everything in org
-- manager: branch_id set   → their branch, including money
-- staff:   branch_id set   → their branch, no financial reads
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  role member_role not null,
  created_at timestamptz not null default now(),
  constraint owner_is_org_wide check (role <> 'owner' or branch_id is null),
  constraint staff_needs_branch check (role = 'owner' or branch_id is not null),
  unique (user_id, org_id, branch_id)
);
create index on public.memberships (user_id);
create index on public.memberships (branch_id);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  full_name text not null,
  phone text,                       -- E.164 preferred: +639XXXXXXXXX
  notes text,
  last_visit_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.clients (business_id, phone);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  staff_id uuid not null references public.profiles(id),
  client_id uuid references public.clients(id),
  kind transaction_kind not null default 'sale',
  amount numeric(12,2) not null check (amount > 0),
  payment_method payment_method not null default 'cash',
  reference_no text,                -- GCash/Maya ref
  description text,
  occurred_at timestamptz not null default now(),
  is_voided boolean not null default false,
  void_reason text,
  voided_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.transactions (branch_id, occurred_at desc);
create index on public.transactions (staff_id, occurred_at desc);

-- Transactions are IMMUTABLE. No update of amount/kind/method ever.
-- Corrections = void (managers/owner only) + new transaction. Enforce in RLS (§5).

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  staff_id uuid not null references public.profiles(id),
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint out_after_in check (clock_out is null or clock_out > clock_in)
);
create index on public.attendance (branch_id, clock_in desc);
-- Partial unique index: one open shift per staff member.
create unique index one_open_shift on public.attendance (staff_id)
  where clock_out is null;

create table public.daily_closes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  close_date date not null,
  expected_cash numeric(12,2) not null,   -- computed server-side at close time
  declared_cash numeric(12,2) not null,   -- what staff counted in the drawer
  variance numeric(12,2) generated always as (declared_cash - expected_cash) stored,
  notes text,
  closed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (branch_id, close_date)
);
```

### 4.3 Extension tables

```sql
-- LAUNDRY: one order per drop-off; lifecycle drives P3.
create table public.laundry_orders (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions(id),
  branch_id uuid not null references public.branches(id),
  client_id uuid references public.clients(id),
  ticket_no text not null,          -- human-readable, branch-scoped: e.g. "A-0042"
  weight_kg numeric(6,2),
  items_note text,                  -- "3 blankets, 1 comforter, handle with care"
  status laundry_status not null default 'received',
  ready_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (branch_id, ticket_no)
);
create index on public.laundry_orders (branch_id, status);

-- Status transitions are FORWARD-ONLY except manager override:
-- received → washing → drying → folding → ready → claimed
-- Any state → cancelled (manager/owner only). Enforce in server action + trigger.

-- SPA / SKINCARE (v2 booking, but migrate schema in v1 so extensions are proven)
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  client_id uuid not null references public.clients(id),
  staff_id uuid references public.profiles(id),   -- therapist/aesthetician
  room_id uuid references public.rooms(id),
  service_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status appointment_status not null default 'booked',
  transaction_id uuid references public.transactions(id), -- set on completion
  created_at timestamptz not null default now(),
  constraint ends_after_starts check (ends_at > starts_at)
);
create index on public.appointments (branch_id, starts_at);
-- Double-booking guards (therapist + room are BOTH resources):
create extension if not exists btree_gist;
alter table public.appointments add constraint no_staff_overlap
  exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (staff_id is not null and status in ('booked','confirmed'));
alter table public.appointments add constraint no_room_overlap
  exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (room_id is not null and status in ('booked','confirmed'));

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
```

### 4.4 Shared infrastructure

```sql
create table public.notifications_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
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
```

### 4.5 Triggers

```sql
-- Auto-create profile on signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'New User'));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Touch clients.last_visit_at whenever a sale references them.
create or replace function public.touch_client_last_visit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is not null and new.kind = 'sale' then
    update public.clients set last_visit_at = new.occurred_at
    where id = new.client_id;
  end if;
  return new;
end $$;

create trigger on_transaction_touch_client
  after insert on public.transactions
  for each row execute function public.touch_client_last_visit();
```

---

## 5. Row Level Security — the enforcement layer

**Golden rule:** the Next.js app is UX only. Authorization is enforced _exclusively_ by RLS. A staff member with devtools open and the anon key must receive **zero** rows they aren't entitled to. Every table gets `enable row level security`; there is no table without it.

### 5.1 Helper functions

`security definer` + `stable` so policies stay fast and don't recurse into `memberships` RLS.

```sql
-- All org IDs where the user is the owner.
create or replace function public.owned_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select org_id from public.memberships
  where user_id = auth.uid() and role = 'owner'
$$;

-- All branch IDs the user can touch (owner → every branch in org; others → their branch rows).
create or replace function public.accessible_branch_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id
  from public.branches b
  join public.businesses biz on biz.id = b.business_id
  where biz.org_id in (select public.owned_org_ids())
  union
  select branch_id from public.memberships
  where user_id = auth.uid() and branch_id is not null
$$;

-- Role for a specific branch ('owner' beats branch-level rows).
create or replace function public.role_for_branch(target_branch uuid)
returns member_role language sql stable security definer set search_path = public as $$
  select case
    when exists (
      select 1 from public.branches b
      join public.businesses biz on biz.id = b.business_id
      where b.id = target_branch and biz.org_id in (select public.owned_org_ids())
    ) then 'owner'::member_role
    else (
      select role from public.memberships
      where user_id = auth.uid() and branch_id = target_branch
      limit 1
    )
  end
$$;

revoke execute on function public.owned_org_ids, public.accessible_branch_ids,
  public.role_for_branch from anon;
```

### 5.2 Policies (complete set for core tables)

```sql
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.businesses enable row level security;
alter table public.branches enable row level security;
alter table public.memberships enable row level security;
alter table public.clients enable row level security;
alter table public.transactions enable row level security;
alter table public.attendance enable row level security;
alter table public.daily_closes enable row level security;
alter table public.laundry_orders enable row level security;
alter table public.rooms enable row level security;
alter table public.appointments enable row level security;
alter table public.stock_items enable row level security;
alter table public.notifications_outbox enable row level security;

-- profiles: read self + colleagues in accessible branches; update self only.
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or id in (
    select m.user_id from public.memberships m
    where m.branch_id in (select public.accessible_branch_ids())
  )
);
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- organizations / businesses / branches: owner full CRUD; members read their scope.
create policy org_owner_all on public.organizations for all
  using (id in (select public.owned_org_ids()))
  with check (id in (select public.owned_org_ids()));
create policy org_member_read on public.organizations for select using (
  id in (select org_id from public.memberships where user_id = auth.uid())
);

create policy biz_owner_all on public.businesses for all
  using (org_id in (select public.owned_org_ids()))
  with check (org_id in (select public.owned_org_ids()));
create policy biz_member_read on public.businesses for select using (
  id in (
    select b.business_id from public.branches b
    where b.id in (select public.accessible_branch_ids())
  )
);

create policy branch_owner_all on public.branches for all
  using (business_id in (select id from public.businesses
         where org_id in (select public.owned_org_ids())))
  with check (business_id in (select id from public.businesses
         where org_id in (select public.owned_org_ids())));
create policy branch_member_read on public.branches for select using (
  id in (select public.accessible_branch_ids())
);

-- memberships: owner manages; users read their own rows.
create policy membership_owner_all on public.memberships for all
  using (org_id in (select public.owned_org_ids()))
  with check (org_id in (select public.owned_org_ids()));
create policy membership_self_read on public.memberships for select
  using (user_id = auth.uid());

-- clients: anyone with access to a branch of that business can read/insert/update.
create policy clients_rw on public.clients for all using (
  business_id in (
    select b.business_id from public.branches b
    where b.id in (select public.accessible_branch_ids())
  )
) with check (
  business_id in (
    select b.business_id from public.branches b
    where b.id in (select public.accessible_branch_ids())
  )
);

-- transactions: THE sensitive table.
-- INSERT: any member of the branch, and staff_id must be themselves.
create policy tx_insert on public.transactions for insert with check (
  branch_id in (select public.accessible_branch_ids())
  and staff_id = auth.uid()
);
-- SELECT: managers/owner see all branch rows; staff see ONLY their own rows
-- (needed to print a ticket they just created — but no branch totals).
create policy tx_select on public.transactions for select using (
  public.role_for_branch(branch_id) in ('owner','manager')
  or (public.role_for_branch(branch_id) = 'staff' and staff_id = auth.uid())
);
-- UPDATE: void-only, manager/owner only. Immutability of financial fields is
-- enforced by a trigger that rejects changes to amount/kind/payment_method/occurred_at.
create policy tx_void on public.transactions for update using (
  public.role_for_branch(branch_id) in ('owner','manager')
) with check (
  public.role_for_branch(branch_id) in ('owner','manager')
);
-- No DELETE policy → deletes impossible for everyone. (Audit trail.)

-- attendance: insert/select own within branch; managers/owner read branch.
create policy att_insert on public.attendance for insert with check (
  branch_id in (select public.accessible_branch_ids()) and staff_id = auth.uid()
);
create policy att_update_own_open on public.attendance for update using (
  staff_id = auth.uid() and clock_out is null
) with check (staff_id = auth.uid());
create policy att_select on public.attendance for select using (
  public.role_for_branch(branch_id) in ('owner','manager')
  or staff_id = auth.uid()
);

-- daily_closes: manager/owner only, both directions.
create policy close_rw on public.daily_closes for all using (
  public.role_for_branch(branch_id) in ('owner','manager')
) with check (
  public.role_for_branch(branch_id) in ('owner','manager')
  and closed_by = auth.uid()
);

-- laundry_orders: all branch members read + write (staff must update statuses).
create policy laundry_rw on public.laundry_orders for all using (
  branch_id in (select public.accessible_branch_ids())
) with check (
  branch_id in (select public.accessible_branch_ids())
);

-- rooms / appointments / stock_items: same branch-scoped pattern as laundry_orders.
-- notifications_outbox: members of the business may insert/read; only the cron
-- service role updates status (service role bypasses RLS by design).
create policy outbox_insert on public.notifications_outbox for insert with check (
  business_id in (
    select b.business_id from public.branches b
    where b.id in (select public.accessible_branch_ids())
  )
);
create policy outbox_read on public.notifications_outbox for select using (
  business_id in (
    select b.business_id from public.branches b
    where b.id in (select public.accessible_branch_ids())
  )
);
```

### 5.3 Immutability trigger for transactions

```sql
create or replace function public.protect_transaction_fields()
returns trigger language plpgsql as $$
begin
  if new.amount <> old.amount
     or new.kind <> old.kind
     or new.payment_method <> old.payment_method
     or new.occurred_at <> old.occurred_at
     or new.staff_id <> old.staff_id
     or new.branch_id <> old.branch_id then
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

create trigger protect_tx before update on public.transactions
  for each row execute function public.protect_transaction_fields();
```

**RLS test requirement (non-negotiable):** Milestone 1 includes a pgTAP or SQL test script that, for each role (owner / manager / staff-A / staff-B / stranger), asserts exact row visibility on `transactions`, `daily_closes`, and `attendance`. Staff-A must not see Staff-B's transactions; a stranger must see zero rows everywhere.

---

## 6. Auth Flow — single login, multiple businesses

1. **Sign-in:** Supabase Auth, email+password (staff accounts are created by the owner; no self-signup — disable public signups in Supabase dashboard, owner invites via `supabase.auth.admin` in a server action using the service role key, server-side only).
2. **Session management:** `@supabase/ssr` package. Middleware (`src/middleware.ts`) refreshes the session cookie on every request and redirects unauthenticated users to `/login`. Route group `(app)` requires a session.
3. **Context resolution:** after login, the root `(app)/layout.tsx` (RSC) loads the user's memberships.
   - Owner with N businesses → business switcher (workspace-switcher pattern, persists selection in a cookie).
   - Staff with exactly one branch → land directly on that branch's home screen; no switcher shown.
4. **Active scope:** `activeBranchId` / `activeBusinessId` live in a cookie (server-readable) and a client context. Every query is scoped by it — but remember, this is convenience only; RLS re-checks everything.
5. **Password reset:** Supabase built-in flow. Owner can trigger reset links for staff.

---

## 7. RBAC Matrix

Three roles. Do not add more in v1.

| Capability                                 | staff | manager         | owner    |
| ------------------------------------------ | ----- | --------------- | -------- |
| Clock in/out (self)                        | ✅    | ✅              | ✅       |
| Record sale/expense (self-attributed)      | ✅    | ✅              | ✅       |
| View own transactions (for ticket reprint) | ✅    | ✅              | ✅       |
| Create/advance laundry orders              | ✅    | ✅              | ✅       |
| View branch transaction list & totals      | ❌    | ✅ (own branch) | ✅ (all) |
| Void a transaction (reason required)       | ❌    | ✅ (own branch) | ✅       |
| Perform daily close                        | ❌    | ✅ (own branch) | ✅       |
| View attendance (others)                   | ❌    | ✅ (own branch) | ✅       |
| Manage clients                             | ✅    | ✅              | ✅       |
| Dashboard (cross-branch, cross-business)   | ❌    | ❌              | ✅       |
| Manage branches, businesses, staff, roles  | ❌    | ❌              | ✅       |
| Export CSV (attendance, transactions)      | ❌    | ✅ (own branch) | ✅       |

UI hides what a role can't do; RLS enforces it.

---

## 8. Application Structure

```
src/
├── middleware.ts                  # supabase session refresh + auth redirect
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx             # session + memberships + scope resolution
│   │   ├── switch/page.tsx        # business/branch switcher (owner)
│   │   ├── dashboard/page.tsx     # owner-only cross-business view
│   │   └── b/[branchId]/
│   │       ├── layout.tsx         # validates access to branchId, sets scope
│   │       ├── page.tsx           # branch home: today at a glance
│   │       ├── sell/page.tsx      # 30-second sale entry
│   │       ├── transactions/page.tsx
│   │       ├── laundry/           # laundry businesses only (guard by type)
│   │       │   ├── page.tsx       # order board grouped by status
│   │       │   └── new/page.tsx   # intake: ticket + weight + client + payment
│   │       ├── attendance/page.tsx
│   │       ├── close/page.tsx     # daily close flow
│   │       └── clients/
│   │           ├── page.tsx
│   │           └── [clientId]/page.tsx
│   ├── api/
│   │   └── cron/notifications/route.ts   # POST only, CRON_SECRET guarded
│   └── admin/                     # owner: businesses, branches, staff mgmt
├── lib/
│   ├── supabase/
│   │   ├── server.ts              # createServerClient (RSC / actions)
│   │   ├── client.ts              # createBrowserClient
│   │   └── admin.ts               # service-role client — import ONLY in cron route
│   │                              #   and owner-invite action; never in client code
│   ├── domain/
│   │   ├── types.ts               # DB row types (generate: supabase gen types)
│   │   ├── schemas.ts             # zod schemas for every action input
│   │   └── laundry-machine.ts     # allowed status transitions map
│   ├── sms/
│   │   ├── provider.ts            # interface SmsProvider { send(to, body) }
│   │   ├── semaphore.ts           # PH driver
│   │   └── noop.ts                # dev driver (logs only)
│   └── actions/                   # server actions, one file per aggregate
│       ├── transactions.ts
│       ├── laundry.ts
│       ├── attendance.ts
│       ├── close.ts
│       └── clients.ts
└── components/                    # shared UI; typed against core domain only
```

**Feature ↔ type gating:** `b/[branchId]/layout.tsx` loads the branch + business type once and exposes it via context. Laundry routes render 404 for non-laundry businesses. Navigation items are derived from an exhaustive `switch (business.type)` with a `never` default.

---

## 9. Feature Specifications (v1)

### 9.1 Sale entry (`/b/[id]/sell`) — the 30-second rule

- Fields: amount (numpad-style large input), payment method (cash default; gcash/maya reveal a reference-no field), optional description, optional client (typeahead by name/phone, inline "quick add").
- Server action `recordSale`: zod-validate → insert transaction → return receipt data. Idempotency: client generates a UUID per submission attempt; retries reuse it (id supplied to insert, conflict = success).
- Success screen shows large confirmation + "New sale" button. Total taps for a cash sale: ≤4.

### 9.2 Laundry orders (`/b/[id]/laundry`)

- **Intake (`/new`):** client (quick add), weight kg, items note, amount, payment (allow `unpaid` note via kind=sale on claim instead — v1 decision: payment recorded at intake OR at claim; a toggle "pay now / pay on claim". "Pay on claim" creates the order with `transaction_id` of a zero-hold? NO — keep simple: order requires a transaction; "pay on claim" creates the transaction at claim time and intake stores `transaction_id` as the intake transaction only when paid. Implement as: `laundry_orders.transaction_id` nullable in that case is WRONG per schema — so: v1 supports **pay at intake only**. Pay-on-claim goes to the v2 backlog. Do not redesign the schema for it now.)
- Ticket number: per-branch sequence formatted `${branchCode}-${n.toString().padStart(4,'0')}`. Generate via a Postgres sequence per branch (table `branch_counters(branch_id, next_no)` with `select ... for update`).
- **Board:** columns = status. Tap an order → advance to next status (forward-only; `laundry-machine.ts` map is the single source of truth, mirrored by a DB trigger). Reaching `ready` enqueues `laundry_ready` in the outbox (if client has a phone).
- **Claim:** mark claimed, timestamp. Search by ticket no or client phone.

### 9.3 Daily close (`/b/[id]/close`)

- Server computes `expected_cash` = Σ cash sales − Σ cash expenses (non-voided, branch, local date Asia/Manila). Show the number ONLY after declared amount is entered (prevents anchoring — staff should count the drawer blind, manager enters the count).
- Manager enters declared cash + notes → insert `daily_closes`. Variance renders green (±0), amber (small), red — thresholds: |variance| ≤ ₱50 amber floor configurable later; hardcode 0/50 for v1.
- A branch with an un-closed previous business day shows a persistent banner.

### 9.4 Attendance (`/b/[id]/attendance`)

- One giant Clock In / Clock Out button (state from the open-shift partial unique index). Managers see a day/week table for the branch. CSV export (manager/owner).

### 9.5 Owner dashboard (`/dashboard`)

- Mobile-first cards, one per business → branches within. Today + this week: revenue, expense, tx count, open laundry orders, staff clocked in now, latest close variance (red badge if |variance| > 0 or close missing).
- One aggregate query per business via a Postgres view `branch_daily_summary` (security invoker so RLS applies).

### 9.6 Clients (`/b/[id]/clients`)

- List, search, detail (visits from transactions, laundry history). "Due for follow-up" tab: skincare clients with `last_visit_at` older than N days (default 30) → button enqueues `rebooking_nudge` (rate-limit: max 1 per client per 14 days, enforce by checking outbox history).

### 9.7 Admin (owner)

- CRUD businesses, branches; invite staff (email → service-role invite → membership row); change roles; deactivate staff (delete membership, keep profile + history).

---

## 10. Notification Pipeline

1. Features **enqueue** rows into `notifications_outbox` (never send inline — keeps actions fast and retries safe).
2. **Cloudflare Cron Trigger** (every 5 min) POSTs to `/api/cron/notifications` with header `Authorization: Bearer ${CRON_SECRET}`.
3. The route (service-role client) claims up to 25 due rows with `update ... set status='sent' pending-claim pattern`: select `pending` where `send_at <= now()` `for update skip locked` → attempt send via `SmsProvider` → mark `sent`/`failed` (+`attempts`, `last_error`). Max 3 attempts, then `failed` stays for manual review.
4. Templates (`template_key` → function of `payload`):
   - `laundry_ready`: "Hi {name}! Your laundry (ticket {ticket}) at {branch} is ready for pickup. Thank you!"
   - `appt_reminder` (v2): "Reminder: {service} tomorrow {time} at {branch}. Reply to reschedule."
   - `rebooking_nudge`: "Hi {name}, it's been a while! {branch} would love to see you — book your next session anytime."
5. Driver: `SEMAPHORE_API_KEY` env var; `NoopProvider` when unset (dev). Normalize phones to E.164 `+63…` at write time; reject un-normalizable phones at enqueue with a clear error.

---

## 11. Environment & Config

```
# .env.local (dev) / Cloudflare Workers secrets (prod via wrangler secret put)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server-only; never NEXT_PUBLIC
CRON_SECRET=                    # random 32+ chars
SEMAPHORE_API_KEY=              # optional in dev
APP_TIMEZONE=Asia/Manila
```

- `wrangler.jsonc`: cron trigger `*/5 * * * *`, `nodejs_compat` flag, name, account id.
- `next.config.ts`: `images: { unoptimized: true }`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to any file imported by client components. `lib/supabase/admin.ts` must start with `import 'server-only'`.

---

## 12. Coding Conventions (Claude Code MUST follow)

1. TypeScript `strict: true`; no `any`; no non-null assertions except immediately after an explicit runtime check.
2. Server Components by default. `'use client'` only for interactivity (forms, the laundry board, switcher).
3. All mutations are **server actions** in `lib/actions/*`; every action: (a) zod-parse input, (b) create server Supabase client, (c) perform write, (d) `revalidatePath` as needed, (e) return a typed `Result` — never throw across the action boundary for expected failures.
4. Database types generated via `supabase gen types typescript` into `lib/domain/types.ts`; regenerate in the same commit as any migration.
5. Money: integer-safe handling — parse UI strings with a single `parsePeso()` util; render with `Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })`.
6. Dates: store UTC; convert at the edge of the UI with a `formatManila()` util. "Business day" = calendar date in Asia/Manila everywhere (daily close, dashboard).
7. Exhaustive `switch` on `business_type` and `laundry_status` with `assertNever(x: never)` default.
8. No client-side fetching of Supabase for lists rendered on load — fetch in RSC, pass down. Client components may call server actions only.
9. Every list query has an explicit `order` and `limit`.
10. Errors surfaced to users are human sentences, not codes; log full detail server-side with `console.error` (visible in `wrangler tail`).

---

## 13. Security Checklist (verify at every milestone)

- [ ] Every table has RLS enabled and at least one policy (a table with RLS on and no policy = invisible; that's the safe default).
- [ ] RLS test script passes for all five personas (§5.3).
- [ ] Service-role key only in `admin.ts` (+`server-only`), used only by cron route and staff-invite action.
- [ ] Public signups disabled in Supabase Auth settings.
- [ ] Cron route rejects requests without valid `CRON_SECRET` (constant-time compare) and rejects GET.
- [ ] No financial aggregate reachable by `staff` role (verify via API call with a staff JWT, not just UI).
- [ ] Transactions cannot be updated (except void flow) or deleted — verified by test.
- [ ] Rate limit login attempts (Supabase built-in) and the rebooking-nudge enqueue (app-level, §9.6).
- [ ] Dependency audit clean (`pnpm audit`) at each milestone.

---

## 14. Build Milestones (execute in order; each ends with passing tests + deployable state)

**M0 — Scaffold.** `create-next-app` (TS, App Router, Tailwind, src dir) → shadcn init → ESLint/Prettier strict config → Vitest + Playwright setup → `@opennextjs/cloudflare` wired with `wrangler.jsonc` → hello-world deploy to Workers to validate the pipeline and bundle size budget.

**M1 — Schema + RLS.** All migrations from §4–5 → `supabase gen types` → RLS persona test script → seed script (`supabase/seed.sql`): 1 org, 3 businesses, 4 branches, 1 owner, 2 managers, 4 staff, 30 days of realistic transactions/orders/attendance for demo purposes.

**M2 — Auth + shell.** Login, middleware, `(app)` layout, membership loading, business/branch switcher, role-aware navigation, branch home skeleton.

**M3 — Money.** Sale/expense entry (30-second rule), transaction list (role-gated), void flow, daily close with variance + missing-close banner.

**M4 — Laundry.** Intake with ticket sequence, status board, forward-only transitions, claim flow, `laundry_ready` enqueue.

**M5 — Attendance.** Clock in/out, manager table, CSV export.

**M6 — Dashboard.** `branch_daily_summary` view + owner dashboard cards; week trend as inline SVG bars (keep the bundle small).

**M7 — Clients + notifications.** Client CRUD/search/detail, follow-up tab, outbox, cron route, Semaphore driver + noop, template rendering, retry logic.

**M8 — Hardening + launch.** Full security checklist pass; Playwright e2e for: staff sale, laundry lifecycle, daily close, owner dashboard; GitHub Actions: lint/test/typecheck on PR, `pg_dump` nightly backup while on free tier; deploy docs; hand-off README for the owner (plain-language, screenshots).

**V2 backlog (do not start unless instructed):** appointments UI on the existing schema (therapist+room resources, exclusion constraints already in place), `appt_reminder` automation (T-24h), stock counts with low-stock/expiry alerts, pay-on-claim laundry, weekly owner email digest, PH SMS sender-ID registration, Supabase Pro migration runbook.

---

## 15. Testing Strategy

- **Unit (Vitest):** zod schemas, laundry transition map, peso/date utils, template rendering, expected-cash computation (pure function fed transaction fixtures — cover voids, expenses, non-cash exclusion, Manila date boundaries at 23:59/00:01).
- **RLS (SQL):** the five-persona visibility suite; runs in CI against a shadow database (`supabase db reset && psql -f tests/rls.sql`).
- **E2E (Playwright):** only the four critical journeys listed in M8, against a seeded local Supabase.
- Coverage targets are not the goal; the RLS suite and expected-cash tests are the two non-negotiables.

---

## 16. Deployment Runbook

```bash
# local dev
pnpm dev                       # next dev against local supabase (supabase start)

# preview production behavior locally
pnpm build && npx opennextjs-cloudflare build && npx opennextjs-cloudflare preview

# deploy
npx opennextjs-cloudflare deploy
wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # once per secret
```

- Two Supabase projects: `bizdesk-dev`, `bizdesk-prod` (uses both free-tier slots; migrations promoted via `supabase db push` from CI on main).
- Custom domain via Cloudflare later; `*.workers.dev` URL is fine for v1.
- Watch Worker size on every deploy; if approaching 3 MiB compressed, run `ANALYZE=true` bundle analysis before adding any dependency.

---

## 17. CLAUDE.md (place at repo root)

```markdown
# bizdesk

Multi-business management system (laundry / spa / skincare) for a PH owner.
Read docs/SPEC.md before any task — it is the source of truth.

## Commands

- pnpm dev · pnpm test · pnpm lint · pnpm typecheck
- pnpm build && npx opennextjs-cloudflare build # bundle-size check
- supabase start · supabase db reset # local db + seed

## Hard rules

- Authorization = RLS only. Never rely on UI checks. Never weaken a policy to "fix" a bug.
- transactions are immutable: void + re-enter, never edit/delete.
- Service-role key: lib/supabase/admin.ts only ('server-only'). Never NEXT_PUBLIC.
- Money = numeric(12,2)/parsePeso; dates stored UTC, rendered Asia/Manila.
- New migration ⇒ regenerate lib/domain/types.ts in the same commit.
- No new runtime dependency without checking Worker bundle size (3 MiB budget).
- Business-type branching only via exhaustive switch + assertNever.
- Never label any output "Official Receipt"/"OR". No payroll computation.

## Definition of done (every task)

typecheck ✓ lint ✓ unit tests ✓ RLS suite ✓ (if schema touched) manual check of
the affected flow as staff AND manager personas from the seed data.
```

---

_End of specification._
