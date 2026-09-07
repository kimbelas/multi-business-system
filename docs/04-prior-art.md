# Prior art — how other systems model the parts we have not built yet

Read before writing the M1 migration. Every claim here was read out of a real schema, a real API
reference or real vendor documentation, and each is marked with which:

- **[SCHEMA]** read from source, DDL or an API object reference
- **[DOCS]** stated in official vendor documentation
- **[INFERRED]** reasoning, not citation

This is not the field study. §3 of that document records what _these three shops_ do; this records
what _other people's software_ does, which is a different kind of evidence and settles different
questions. Where the two disagree, the shops win.

Systems surveyed: Odoo POS 17 (and 13, for what was deleted), ERPNext / Frappe, Frappe Books,
Dolibarr, Floreant POS, uniCenta oPOS, Square, Toast, Shopify POS, Lightspeed R-Series and X-Series,
Loyverse, CleanCloud, SMRT, SPOT/Xplor, Enlite/DarkPOS, Turns, Starchup, Geelus.

---

## 1. The daily close

### 1.1 Denomination counting — don't, at least not in v1

Six of eight general POS systems **do not store the breakdown at all**. The counting grid is a
calculator whose output is one number.

- **[SCHEMA] Odoo had the normalised model and deleted it.** Odoo ≤13 had
  `account.cashbox.line (coin_value, number, subtotal, cashbox_id)` hanging off
  `account.bank.statement.cashbox`. In Odoo 17 the word `cashbox` does not appear in
  `account/models/account_bank_statement.py`. What replaced it is worse than nothing: the browser
  builds a string — `"Money details:\n - 3 x $100\n…"` — and writes it into `pos.session.closing_notes`,
  a free-text column. And `setManualCashInput()` **clears the breakdown** if the closer then types a
  total by hand. A silent data loss on the audit path.
- **[SCHEMA]** ERPNext, Lightspeed R-Series, Shopify POS, Square and Dolibarr store no denomination
  structure. Lightspeed's `RegisterCountAmount` is one row **per payment type** (`calculated`,
  `actual`), not per denomination — its UI collects the breakdown and discards it.
- **[DOCS]** Toast counts by denomination in the UI and exposes none of it on the API.
- **[SCHEMA] The one real implementation is Frappe Books**, and it is the shape to copy if we ever do
  this: a `CashDenominations` abstract child (`denomination` Currency) extended by `OpeningCash` and
  `ClosingCash`, each adding `count` Int, with the branch's denomination list configured separately
  as `Defaults.posCashDenominations`. A child table, never a JSON blob — **no surveyed system uses a
  blob.**

**Decision this supports:** the PH paper form counts by denomination (field study §7.1), but no
software does, and the grid costs taps on the one screen with a four-tap budget. Keep
`declared_cash` as one total for v1. If it is ever added, add it as `cash_count_lines(close_id,
denomination, count)` and never as text.

### 1.2 The blind close must be structural, and there is a published example of it being fake

**[SCHEMA] The OCA module `pos_blind_session_closing` is cosmetic.** It ships one `res.groups`
record and two JavaScript patches. There is **no `models/` directory in the module**. The server
still sends `default_cash_details.amount` in the RPC payload, so anyone with a dev-tools tab reads
the expected cash the control is meant to hide.

That is this repository's own registered risk, already written down before the module was found:
_"the screen would look correct, no test would go red, and the control the owner is relying on would
simply be gone."_

**[SCHEMA] Lightspeed R-Series is the shape that works.** Expected cash lives on a **separate
endpoint** — `GET /Register/{id}/calculated.json`, returning `CalculatedAmount[]` — and the close
POST neither carries nor returns it. Blindness is a property of the API surface, not of a template.

The four mechanisms found, cheapest first:

| System       | Mechanism                                                       | Strength                                          |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------- |
| Loyverse     | **[DOCS]** revoke the `View shift report` access right          | No schema change; server still knows              |
| Lightspeed X | **[DOCS]** `Conceal cash totals`, a boolean on the payment type | Revealed after closure completes                  |
| Toast        | **[DOCS]** `Manager > 3.17 Cash Drawers (Blind)` permission     | Hides it **permanently**, including on the report |
| Lightspeed R | **[SCHEMA]** expected cash on a separate endpoint               | Structural — cannot leak through a template       |

**[DOCS] Toast's is the strongest product behaviour**: a blind closer has "no insight as to cash
payments taken, expected closing amounts, expected deposits, or any cash drawer overages/shortages" —
not at submission, not afterwards. Two people closing the same drawer can have different visibility.

**[SCHEMA] ERPNext does the opposite and it is instructive.** `pos_closing_entry.js::refresh_payments`
sets `payment.closing_amount = payment.expected_amount`. The cashier's **default answer is "no
variance"**, pre-filled. And `difference` is computed in the browser, stored read-only, and never
re-validated server-side — whatever the browser posts is what lands in the ledger.

**[DOCS] The fraud a blind close stops is short ringing**, and the documented workaround when the
target is visible is exactly what you would expect: an operator describing "entering a false amount
to force the Drawer Amount to appear correct". Staff back-solve to the number they were shown.

**Decisions this supports:** card 0006's criterion should assert against the **response body**, not
the rendered page; expected cash must not be in the close form's data path at all; and the reveal
after submission is a weaker control than Toast's — worth deciding deliberately rather than by
default.

### 1.3 A witness is real, and three systems model it three ways

- **[SCHEMA] Square** splits trading from auditing. `CashDrawerShiftState` is `OPEN` → `ENDED`
  ("ended but has not yet had an employee content audit") → `CLOSED` ("closed with a completed
  employee content audit"). Three actors: `opening_team_member_id`, `ending_team_member_id`,
  `closing_team_member_id` — the last defined as "the team member that closed the shift **by auditing
  the cash drawer contents**".
- **[SCHEMA] Toast** puts an approver on **every cash entry**: `CashEntry.employee1` (who made it) and
  `employee2` (who approved it).
- **[SCHEMA] Dolibarr** models it as a two-step workflow: `llx_pos_cash_fence` carries
  `fk_user_creat` + `date_creation` and `fk_user_valid` + `date_valid` with a draft/closed `status`.
- **[SCHEMA] Nobody else has it.** ERPNext has one `user`. Lightspeed and Shopify have
  open/close actors, which are sequential, not co-signers. **Odoo has no `closed_by` at all** — who
  counted survives only in a chatter message.

The PH paper form has two signatures (field study §7.1). Square and Toast both recommend pairing the
blind close with a second person; Toast's guide says to pair permission 3.17 with `3.12 Shift Review`
"as an extra level of cash handling accountability".

**Decision this supports:** `counted_by` + `counted_at` alongside `closed_by` is nearly free before
there is data, and it is what lets a manager count a drawer the staff member walked away from — the
same shape as the auto-closed shift already settled for attendance.

### 1.4 The float is not a constant, and no system treats it as one

This is the finding that questions a decision already made. Card 0044 settled on
`branches.opening_float numeric(12,2)` as a standing amount per branch, on the argument that a shop's
float is a policy rather than a daily decision.

**No system in the survey holds a float that way.**

- **[SCHEMA] Odoo carries it forward from the previous count.**
  `action_pos_session_open` sets `cash_register_balance_start = last_session.cash_register_balance_end_real`.
  The float is last night's counted close, not a configured number.
- **[SCHEMA] Lightspeed R-Series makes the float a row in the same signed table as everything else.**
  `RegisterWithdraw.amount` — "Negative amounts are for payout/withdrawals. Positive for adds/**opening
  counts**". One table covers pay-in, payout and the float.
- **[SCHEMA] Shopify stores two openings and reports the gap.** `expectedOpeningBalance` ("the amount
  expected to be in the cash drawer based on the previous session") alongside the counted
  `openingBalance`, and its reports split variance into **Opening discrepancy** and **Closing
  discrepancy**.

That last one matters more than the rest of this document. **An opening discrepancy is cash that
moved while nobody was on shift** — which is the leakage this system exists to find, and a close
scoped to its own day cannot see it.

**Decision this challenges:** `branches.opening_float` as a standing column is defensible only if
the drawer really is reset to the same number every morning. That is worth confirming at a branch
before the migration, and it is now a line in the field study.

### 1.5 Cash movements are one signed table

**[SCHEMA] Universal.** Lightspeed's `RegisterWithdraw` (signed `amount`, `notes`, `employeeID`),
Shopify's `CashTrackingAdjustment` (signed `cash`, `note`, `staffMember`, `time`), Square's
`CashDrawerShiftEvent` (`event_money`, nine `CashDrawerEventType` values), Toast's `CashEntry` (eleven
types including `CASH_IN`, `PAY_OUT`, `TIP_OUT`, `NO_SALE`).

- **[SCHEMA] Odoo has no dedicated model** and reuses `account.bank.statement.line`, concatenating the
  reason into `payment_ref` as a string. The anti-pattern.
- **[SCHEMA] Toast's reasons are configured entities with GUIDs** (`payoutReason`, `noSaleReason`),
  admin-managed so they aggregate. Free text never will.
- **[SCHEMA] Toast corrects by reversal, never by edit** — an undo creates a new entry carrying
  `undoes` = the original GUID. The same rule this project already adopted for sales.
- **[SCHEMA] Square logs non-cash tenders to the drawer with a zero amount**, so the log answers "why
  was the drawer open", not only "what cash moved".
- **[SCHEMA] POS Awesome's `POS Cash Movement` carries `client_request_id`** as an idempotency key —
  the field name for something already committed to here.

### 1.6 Variance: stored or computed, and thresholds barely exist

- **[SCHEMA] Computed, not stored:** Odoo 17 (`cash_register_difference` is `compute=` with **no**
  `store=True` — and Odoo 13's stored version was removed), Lightspeed, Square (no `difference` field
  exists anywhere in the API), Dolibarr.
- **[SCHEMA] Stored:** Shopify — `CashTrackingSession.totalDiscrepancy`, and the reason is explicit:
  `CashTrackingSessionsSortKeys` includes `TOTAL_DISCREPANCY_DESC`. **They materialised it so it could
  be sorted on.** That is exactly the settled decision to order branches by absolute variance,
  largest first.
- **[SCHEMA] Toast stores it as a ledger row**, which is the most interesting option found: closing a
  drawer emits a `CashEntry` of type `CLOSE_OUT_EXACT` / `CLOSE_OUT_OVERAGE` / `CLOSE_OUT_SHORTAGE`
  whose amount is the delta — immutable, timestamped, attributed, in the same ledger as every other
  movement.
- **[SCHEMA] Thresholds: only Odoo has one.** `pos.config.set_maximum_difference` +
  `amount_authorized_diff`, per-register, with a manager override. Square, Shopify, Toast, Lightspeed
  and ERPNext ship none, and none has a colour band.

**Decision this supports:** "no variance bands in week one" is not a compromise — it is what the
category does. When bands do arrive, Odoo's shape is right: a per-branch value plus a role that can
override, never a global constant.

### 1.7 Sessions beat dates, and this repository chose a date

**[SCHEMA] Session-keyed:** Odoo (`pos.session`, `start_at`/`stop_at`, four-state machine, no date
column), ERPNext (`POS Closing Entry.pos_opening_entry` → opening entry, `period_start_date` /
`period_end_date`), Square (`opened_at`), Shopify (`CashTrackingSession`, no date field), Lightspeed
R-Series (`openTime` → `createTime`).

**[SCHEMA] Lightspeed X-Series arrived independently at branch + sequence**: `payments_summary`
returns `register_closure_sequence_number` — closures numbered per register. That is card 0018's
shift number, shipped by somebody else.

**[SCHEMA] Toast keys on `businessDate` in `yyyymmdd`** — and solves midnight by having the merchant
**declare where the day ends**, rather than trusting the clock.

**[SCHEMA] Dolibarr is the pure calendar case and it is the warning**: `day_close`, `month_close`,
`year_close`, `hour_close`, `min_close`, `sec_close` — six integers to reassemble before you can
sort. (It also stores money as `double(24,8)`.)

**What breaks when nobody closes:**

- **[SCHEMA] Odoo creates a rescue session** named `"(RESCUE FOR <session>)"` with `rescue=True`,
  seeded from the last real close — the comment says "making it obvious that something went wrong".
  It nags via a `mail.activity` after 7 days and **never auto-closes**.
- **[DOCS] Square auto-ends only after 30 days open with 7 days of inactivity.**
- **[DOCS] Shopify degrades its own reports** rather than closing for you.
- **[DOCS] Toast names the state**: `Paused` — "not in use… the cash has **not** been counted".

**Decision this supports:** the settled answer on forgotten clock-outs — surface it to the manager,
never guess — is what the whole industry does with an abandoned drawer too. And `branch + date +
shift_number` is defensible **because of the shift number**; the date component buys a natural key and
costs the midnight case. A spa closing at 23:00 and cashing up at 00:15 must not land on tomorrow, and
that is the same Manila-boundary test the expected-cash card already owes.

---

## 2. Ticket numbers

Card 0020's question, answered. This repository has no ticket numbering yet — `supabase/migrations/`
is identity and RLS only — so this is a create, not an alter.

### 2.1 What the laundry vendors actually do

- **[DOCS] CleanCloud: per store, starts at 1, increments by 1, and never resets.** "You can't jump,
  skip, or renumber orders inside the POS"; restarting at 1 requires deleting every order. Multi-store
  collisions are avoided by **disjoint ranges** ("Store A → 1000+, Store B → 5000+"), set by the
  vendor's back office. Invoice numbers are a separate sequence with a user-settable prefix.
- **[DOCS] SMRT is the only documented reset, and it wraps:** "Store Specific Order Number" runs
  10001–99999 and **starts over from 10001**, reusing numbers with no collision warning. It is a
  racking number, layered over the real id.
- **[INFERRED, from token examples] SPOT embeds the store in the number**: `03-100020`, `05-100007`,
  with `07-00002:1` identifying a piece. Two independent strategies exist across the market — store
  identity **inside** the number, or **disjoint ranges** — and no vendor combines them.
- **[DOCS] Enlite splits ticket from invoice by punctuation**: tickets have no dash, invoices do
  (`557-1`, `557-2`, one per department).
- **[DOCS] Phone is the universal lost-ticket fallback.** CleanCloud searches order id, phone, name and
  order notes; SPOT adds drop-off date range and heat-seal-label range; Turns identifies by name or
  phone. **Starchup offers only date filters and ships a troubleshooting article titled "Can't find an
  order"** — which is the argument for capturing phone at intake, made by somebody else's support
  queue.

### 2.2 Two strategies, and Odoo ships both

**[SCHEMA] `ir.sequence` in Odoo is the cleanest side-by-side of the two options in any codebase:**

- `implementation='standard'` creates a **real Postgres sequence** (`CREATE SEQUENCE ir_sequence_%03d`)
  — fast, and gap-prone.
- `implementation='no_gap'` uses a **counter row** with `SELECT number_next … FOR UPDATE NOWAIT`
  followed by an `UPDATE`. Odoo's own field help concedes "there can still be gaps if records are
  deleted" and that it is "**slower** than the standard one".
- **[SCHEMA] The reset boundary is a child model**: `use_date_range` + `ir.sequence.date_range`, each
  range getting **its own** Postgres sequence, defaulting to calendar years.

**[SCHEMA] Frappe's version is better and the idea is worth stealing outright.** `tabSeries(name,
current)` is a counter row keyed by the **interpolated prefix**: `parse_naming_series` expands date
placeholders first, then calls the generator with everything accumulated so far as the key. So
`SINV-.YYYY.-.#####` produces key `SINV-2026-`, and **a new counter row simply appears each year and
starts at 1**. The reset is a consequence of the key, not a scheduled job.

**[DOCS] Postgres is unambiguous that sequences cannot be gapless**, verbatim: "the value obtained by
`nextval` is not reclaimed for re-use if the calling transaction later aborts… **PostgreSQL sequence
objects cannot be used to obtain 'gapless' sequences**." `CACHE > 1` makes it worse; `CYCLE` reuses
numbers (which is what SMRT does).

### 2.3 The ticket number is not the primary key

- **[SCHEMA] uniCenta oPOS** splits them: `TICKETS.ID VARCHAR(255)` UUID as PK, `TICKETID INTEGER` as
  the human number, on a **non-unique** index — and its counter is a single-row `TICKETSNUM` table
  with **no location column**, so a SourceForge feature request exists asking for per-location
  numbering. Retrofitting that is a known pain in that codebase.
- **[SCHEMA] Odoo** splits them: `id` serial PK, `pos_reference` a separate **indexed but not unique**
  Char — which doubles as the sync idempotency key (`_process_order` searches it before creating).
- **[SCHEMA] Floreant and Frappe conflate them and pay for it.** Floreant's ticket number _is_ the
  identity column, so it is global, gap-prone and unchangeable. Frappe's `doc.name` _is_ the naming
  series string, which is why Frappe needs an entire rename/amend subsystem.
- **[SCHEMA] Odoo's three tiers of number in one codebase** are a useful reminder that the scannable
  token and the spoken token are different things: `pos_reference` at 12 digits ("to fit into EAN-13
  barcodes"); `tracking_number` at 3 digits, deliberately recycling every 100 orders, for a "your order
  is ready" board; and `ticket_code`, 5 random alphanumerics, **random precisely so customers cannot
  enumerate each other's receipts**.

### 2.4 The recommended shape

```sql
create table branch_ticket_counter (
  branch_id  uuid   not null references branches(id) on delete restrict,
  period_key text   not null default '',      -- '' never resets; '2026' yearly; '2026-09-07' daily
  next_value bigint not null default 1,
  primary key (branch_id, period_key)
);
```

Allocation is **one statement** — no separate `SELECT … FOR UPDATE`, and no race on a branch's very
first order:

```sql
insert into branch_ticket_counter (branch_id, period_key, next_value)
values ($1, $2, 2)
on conflict (branch_id, period_key)
do update set next_value = branch_ticket_counter.next_value + 1
returning next_value - 1 as ticket_seq;
```

Wrapped for Supabase, where RLS must never expose the counter:

```sql
create or replace function next_ticket_seq(p_branch uuid, p_period text default '')
returns bigint language sql security definer set search_path = public as $$
  insert into branch_ticket_counter (branch_id, period_key, next_value)
  values (p_branch, p_period, 2)
  on conflict (branch_id, period_key)
  do update set next_value = branch_ticket_counter.next_value + 1
  returning next_value - 1;
$$;

alter table branch_ticket_counter enable row level security;  -- no policies: only the definer touches it
revoke all on function next_ticket_seq(uuid, text) from public;
grant execute on function next_ticket_seq(uuid, text) to authenticated;
```

The guarantee lives on the order table, not in the allocator:

```sql
alter table laundry_orders
  add column ticket_seq bigint not null,
  add constraint laundry_orders_ticket_unique unique (branch_id, ticket_seq);
```

**Why this shape:**

- **A row lock, not a table lock.** `ON CONFLICT DO UPDATE` holds a row-level lock to commit.
  Concurrent orders at one branch serialise; branches never block each other. The widely-cited
  gapless-counter write-up uses `LOCK TABLE … ACCESS EXCLUSIVE`, which serialises every branch against
  every other for no benefit.
- **Gapless because it rolls back.** The increment lives in the order's transaction, so a failed
  insert un-increments — the property `nextval` cannot give you.
- **The reset is a key, not a job** — Frappe's idea. `period_key = ''` never resets; a yearly reset is
  `to_char(now() at time zone 'Asia/Manila','YYYY')`. **Deriving that key in Manila time is
  load-bearing**: a UTC-derived key rolls the counter at 08:00 local, which is the same boundary the
  expected-cash function already owes a test.
- **Not a sequence per branch.** That means DDL on branch creation, and it is gap-prone anyway.

**Each of these deserves a test:**

- **Allocate as late as possible in the transaction.** The branch is serialised from allocation to
  commit — never allocate and then call an SMS provider.
- **Deletes still make gaps.** "Correction is a void plus a new transaction, never an edit" already
  forecloses this; keep it.
- **Idempotency ordering.** A retried submit must not burn a number: either insert the order keyed on
  the client's idempotency key first and allocate only if that insert won, or allocate first and let
  the unique-violation path roll the whole transaction back before re-reading. Odoo does the
  equivalent by checking `pos_reference` before processing.
- **Keep the display format out of the schema.** `ticket_seq bigint` is the number; `A-0042` or
  `03-100020` is branch configuration rendered in the app — which is exactly what the settled question
  reserved for later.

**Not verified by execution.** The `RETURNING next_value - 1` semantics on both the insert and
conflict paths are reasoned from the Postgres documentation and two real implementations. One
integration test — two concurrent transactions, one rolled back, assert no gap and no duplicate —
before it ships.

---

## 3. Packages, tabs, tips and unpaid orders

Researched separately; this section is written when that lands.
