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

## 3. Tips

### 3.1 Three shapes, and Floreant migrated between two of them in public

- **[SCHEMA] Odoo puts the tip on the sale as a product line — the shape to avoid.** `pos.order`
  carries `is_tipped` Boolean and `tip_amount` Float; `pos.config.tip_product_id` names a product;
  `set_tip()` creates a `PosOrderLine` holding that product and then raises the payment line's amount.
  `pos.payment` has **no tip column at all**, so a card tip is recorded by inflating the card payment.
  Consequences: the tip inflates sales revenue, and there is **no tip-to-employee link anywhere in
  Odoo POS**.
- **[SCHEMA] Square and Lightspeed put it on the tender.** `Payment.tip_money`, `Tender.tip_money`,
  `SalePayment.tipAmount`. **Square contradicts itself in its own API**: `Payment.amount_money`
  _excludes_ the tip, while `Tender.amount_money` _includes_ it. Whichever convention we pick has to be
  written on the column, because a reader will assume the other one.
- **[SCHEMA] Floreant owns a tip record, and the migration is visible in the source.** Table
  `GRATUITY`: `AMOUNT`, **`PAID`** (has it reached the employee yet), `TICKET_ID`, **`OWNER_ID` → User**,
  `TERMINAL_ID`. And in `Ticket.hbm.xml` the previous design is still there, commented out:
  `gratuityAmount` / `gratuityPaid` columns on the ticket, replaced by a `many-to-one` to `Gratuity`.
  They started where Odoo is and moved to a record with an owner and a payout flag.

**[SCHEMA] Attribution is where Square is wrong for a spa.** `Payment.team_member_id` is "the
TeamMember associated with **taking** the payment" — the front desk, not the therapist. Floreant keeps
`GRATUITY.OWNER_ID` separate from `TICKET.OWNER_ID` precisely so the two can differ. Our
`transactions.staff_id` is whoever entered the row, so a tip needs its own recipient column or it is
attributed to the wrong person by construction.

### 3.2 A tip counts toward expected cash if and only if it physically entered the drawer

**[SCHEMA] Floreant's `DrawerPullReport.calculate()` states it as arithmetic**, and it is the
clearest statement found anywhere:

```java
setDrawerAccountable(beginCash + totalCash - tips - totalPayout - cashBack - drawerBleed);
// tips == getTipsPaid()  (cash handed OUT of the drawer to settle card tips)
```

`DRAWER_PULL_REPORT` stores `CASH_TIPS` and `CHARGED_TIPS` as separate columns, and **`CASH_TIPS`
does not appear in `drawerAccountable` at all**. Only tips paid _out_ of the drawer subtract.

**[DOCS] Toast reaches the same place from the other direction** by keeping the two in different
subsystems entirely. A card tip is money the business holds and owes staff, so paying it out is a
drawer event (`CashEntry.type = TIP_OUT`). A cash tip is never a drawer event — it is _declared_
during shift review, and Toast is explicit that "any cash tips entered on the Toast POS device are
ignored". Employee reconciliation is `cash sales − non-cash tips`; declared cash tips are not in that
subtraction.

**The ₱1,000-for-a-₱900-service case, resolved:**

| What actually happened                                | Rows                                    | Drawer expects                             |
| ----------------------------------------------------- | --------------------------------------- | ------------------------------------------ |
| ₱1,000 into the drawer, ₱100 is the therapist's       | sale ₱900 + tip ₱100, cash              | **₱1,000**; the ₱100 leaves later          |
| ₱900 into the drawer, ₱100 handed over at the counter | sale ₱900 cash + declared cash tip ₱100 | **₱900** — the tip is drawer-neutral       |
| ₱900 on GCash, ₱100 tip on the same payment           | sale ₱900 + tip ₱100, non-cash          | **₱0**; ₱100 becomes owed to the therapist |

**The system cannot infer which of the first two happened.** Whoever enters the sale has to say. That
is the whole design problem, and it is one boolean.

### 3.3 Tip versus service charge — RA 11360 is a flag other systems already have

**[SOURCE] RA 11360** amends Art. 96: "All service charges collected by hotels, restaurants and
similar establishments shall be distributed completely and equally among the covered workers except
managerial employees." _(The twice-monthly distribution rule lives in the IRR, DOLE D.O. 206-19, which
could not be fetched — treat that detail as unverified.)_

- **[DOCS] Toast expresses the entire distinction as one setting** on the service-charge definition:
  **"Assign to check owner (Gratuity)"** — either a gratuity paid to the check owner, or a
  non-gratuity collected by the restaurant and added to net sales. RA 11360 is that flag, made
  compulsory.
- **[SCHEMA] Square uses two different objects.** `OrderServiceCharge` (percentage XOR amount,
  `calculation_phase`, `treatment_type`, `scope`, `taxable`) versus `Payment.tip_money` — and the
  stated rule is about _whose money it is_: use a service charge to record tips for external vendors
  so they do not enter "the seller's internal team members' tip pool".

**Decision this supports:** keep the word "tip" for discretionary money attributed to a person. If a
mandatory charge ever appears, copy Toast's flag rather than overloading `tip_amount` — the two are
legally different in the Philippines, not merely different in accounting.

---

## 4. Unpaid orders and pay-on-collection

Card 0017's question, and the answer is unanimous.

### 4.1 Every system points payment → order. None points order → payment.

**[SCHEMA]** Square `Payment.order_id`. Odoo `pos.payment.pos_order_id` (`required=True, index=True`).
ERPNext Payment Entry references. Lightspeed embeds a `payments[]` collection on the sale.

**No surveyed system puts a mandatory payment id on the order.** `laundry_orders.transaction_id
NOT NULL` is the shape nobody chose.

**[SCHEMA] The one system that does put payment state on the order is the cautionary tale.**
CleanCloud — a laundry POS — reduces it to scalars: `paid` (1/0), `paymentType` (an integer),
`creditUsed`, `tip`. There is **no payment record with its own timestamp, staff member or branch**, so
flipping `paid` from 0 to 1 says nothing about _which day's drawer_ the money belongs in. That is
precisely the question a blind close has to answer.

### 4.2 Revenue on intake day or payment day? Two coherent answers.

**[DOCS] Toast's house accounts — revenue at intake, drawer untouched**, verbatim: "close out POS
orders during a business day as **paid for sales reporting purposes**, while **deferring the
payment(s)** towards the outstanding balance of a house account". The sale is today's revenue; the
tender is a receivable.

**[SCHEMA] Odoo implements the same idea structurally, and the mechanism is worth stealing.** An order
is always fully tendered — a session refuses to close with drafts open — but a payment method of type
`pay_later` ("Customer Account") carries a `receivable_account_id` of type `asset_receivable`. Then
the drawer count simply filters:

```python
cash_payment_method = session.payment_method_ids.filtered('is_cash_count')[:1]
```

So `pay_later` tenders are **invisible to the theoretical closing balance automatically** — not by a
special case in the close, but because they are not cash. When the customer pays later, that payment
is an ordinary cash event on _that_ day's session.

**[SCHEMA] ERPNext takes the accrual route**: a Sales Order posts no GL entry at all and carries
`advance_paid` / `per_billed`; revenue arrives with the invoice, cash with a Payment Entry.

### 4.3 Deposits are what kill a single FK

**[SCHEMA]** Lightspeed derives `Sale.balance = calcTotal − calcPayments` and flips `Sale.completed`
only when they match. ERPNext derives `outstanding_amount`. Square requires several `CreatePayment`
calls with `autocomplete: false` then `PayOrder`, which completes the order only when the payments sum
to the total. **Floreant is the exception and owns the bug for it** — it stores both `PAID_AMOUNT` and
`DUE_AMOUNT` as columns.

A deposit means **many payments per order**. That is the fact that decides the column shape, more than
pay-on-claim does.

### 4.4 Never collected

Undocumented across the laundry vertical — no CleanCloud or SPOT article on aging or unclaimed orders,
despite both vendors' own customers publishing 30-and-90-day abandonment terms (field study §7).
General mechanisms: **[DOCS]** Toast force-closes stale open checks at a configurable closeout hour
(default 04:00 local) with zero tips; **[SCHEMA]** ERPNext writes off via
`Sales Invoice.write_off_amount` / `write_off_account`.

### 4.5 What this settles for the migration

**Build:**

1. **`laundry_orders.transaction_id` becomes nullable.** Nothing surveyed supports a mandatory payment
   id on an order.
2. **Snapshot the payment mode on the order, not only on the branch.** Add
   `payment_mode ('at_intake' | 'on_claim')`, written at intake from the branch setting, with
   `CHECK (payment_mode = 'on_claim' OR transaction_id IS NOT NULL)`. **A branch-level check
   constraint cannot see the branch row**, and a branch will change modes while orders are open — the
   registered risk already names "an order taken in one mode and claimed after the branch switched" as
   the case that will actually occur. Every surveyed system stores the tender kind on the sale rather
   than looking it up, for the same reason.
3. **Expected cash stays `Σ transactions` and never reads `laundry_orders`.** Toast, Odoo and Floreant
   all compute the drawer from payment events only. An unpaid order contributes zero on intake day;
   the claim-day payment is an ordinary cash transaction on the claim day's close. Both modes plus the
   mode-switch case belong in the pure function's unit tests before either intake screen exists.
4. **If tips are recorded at all, record three things:** `tip_amount numeric(12,2) not null default 0`,
   `tip_recipient_staff_id uuid null` (distinct from `staff_id`, which is whoever entered the row), and
   `tip_in_drawer boolean not null`. Expected cash adds `tip_amount` only where
   `tip_in_drawer and payment_method = 'cash'`. That boolean is the entire ₱1,000/₱900 problem.
5. **Comment the tender convention on the column**, because Square proves a reader will assume the
   other one. Recommended: `amount` is service revenue, `tip_amount` is broken out, the drawer sees
   `amount + tip_amount` filtered as above.

**Skip in v1:**

- **A tip product line** (Odoo's shape) — inflates revenue with staff money and gives no attribution.
- **Tip-out ledgers and tip pooling.** Toast's `TIP_OUT` machinery exists because card tips are settled
  in cash nightly. With cash-dominant branches and rare GCash tips the balance owed is small.
- **Service charges, auto-gratuity, `treatment_type`, `scope`.** No mandatory charge exists here yet.
- **Deposits and partial payments.** They force many-payments-per-order and immediately break the
  nullable single FK. Record the cost explicitly: if deposits are ever wanted, that is when a
  `laundry_order_payments` join table arrives — so it is priced rather than discovered.
- **A stored `balance_due`.** Every system derives it except the one that owns a consistency bug.
- **A tip prompt on the laundry intake path.** A tap on the entry that must stay at four, for the one
  business where tipping is rare.
- **Aging or write-off of uncollected orders.** Nothing in the vertical automates it; the stale-order
  filter already planned for the status board is the equivalent.

---

## 5. Prepaid packages, and the day the takings look wrong

The gap the field study found that was not on the board at all: a clinic sells "5 sessions for
₱18,000", the client pays once and consumes it over months, and nothing tracks the balance.

### 5.1 The accounting question decides the schema, not the other way round

**[DOCS] ASC 606-10-55-46, verbatim** (IFRS 15.B44 is word-identical): "upon receipt of a prepayment
from a customer, an entity should recognize a **contract liability** in the amount of the prepayment
for its performance obligation to transfer, or to stand ready to transfer, goods or services in the
future. An entity should **derecognize that contract liability (and recognize revenue) when it
transfers those goods or services**."

**[DOCS] A fixed-session package is recognised _per session_, not spread over time.** KPMG's revenue
handbook, citing TRG 01-15.16, uses this exact fact pattern: "a contract that obligates the entity to
provide a customer access to its health club **ten times** would diminish each time the customer uses
the health club." Only an _unlimited_ membership is a stand-ready obligation recognised ratably.

**And the vendors encode precisely that split.** Mindbody's Outstanding Series report computes
unearned value as **visits remaining** for a limited pricing option and **days remaining** for an
unlimited one — the software's two formulas are the standard's two promise types. Zenoti shows package
revenue on the redemption date in one report and the sale date in another, on the same screen. Timely
defers to redemption outright.

_(Verification: the ASC 606 and KPMG citations are from PDFs and quotable as they stand. The Mindbody
and Zenoti help pages are Salesforce SPAs that returned shells to a fetch — those two are second-hand.
The Boulevard page in §5.3 was verified firsthand.)_

### 5.2 The shape: two enum values and one nullable FK

This is the finding that makes the feature cheap. A redemption does not need a parallel reporting
path — it needs to be a transaction with a payment method that is not money:

```sql
alter type transaction_kind add value 'prepayment';   -- money in, not revenue
alter type payment_method  add value 'package';       -- revenue, no money
alter table package_redemptions add column transaction_id uuid unique references transactions(id);
```

- **Package sale** — `kind='prepayment'`, `amount=18000`, `payment_method='cash'`. In the drawer, out
  of revenue.
- **Redemption** — `kind='sale'`, `amount=3600`, `payment_method='package'`. Revenue, no cash. This is
  Zenoti's `Sale type = Redemption`, and Shopify's gift-card treatment: the full value of the item is
  claimed as sales, with the prepaid instrument as the tender.

**Expected cash needs no special case.** It already filters `payment_method = 'cash'`, so `'package'`
is excluded structurally — the same trick as Odoo's `is_cash_count` filter in §4.2, and the same one
that makes a running tab free.

**`revenue today = Σ(kind='sale')` is then honest every day**, with no deferral engine, no scheduler
and no GL. **[DOCS] None of the salon systems posts a journal entry either** — they report the
roll-forward and hand it to the bookkeeper. That stays the right scope here.

Outstanding liability is `Σ prepayments − Σ redemptions − Σ expired`, and it clears, because expiry has
somewhere to go. Rounding: the last redemption takes `amount_paid − Σ prior redemptions`, so five
₱833.33 sessions still total ₱2,500.

Supporting tables, from the same survey: a `client_packages` / `package_redemptions` pair with the
**balance derived rather than stored**, a `seq` column plus a partial unique index to stop a session
being redeemed twice, and FEFO ordering when a client holds more than one package.

### 5.3 What a consumed session is worth, when a package is refunded

**[DOCS] The menu price is not the answer, and the standard says so.** ASC 606-10-32-32: a list price
"may be (but **shall not be presumed to be**) the standalone selling price". If nobody actually buys
single sessions at the menu rate, that rate is not evidence. And 606-10-32-36 requires a discount to be
allocated "proportionately to all performance obligations" — the exception in 32-37 needs three or more
obligations with one demonstrably outside the discount, which five identical sessions cannot satisfy.

So a consumed session is worth the **package rate**, not the à-la-carte price. That was going to be the
convenient answer anyway; it is now the correct one.

**[DOCS] Boulevard publishes the identical formula** and calls it standard practice — verified
firsthand. Voucher value is "the membership or package purchase price divided by the number of voucher
groups within that package, and then divided among the vouchers", worked through as "a package of 4
manicures for $100 … a voucher value of $25 each", with the difference from the menu price shown on the
order as an explicit **`Adjustment`** line: "A manicure is $35 and the voucher value is $25. Therefore,
the adjustment is -$10."

### 5.4 The consequence the owner will notice first

**On package-sale day the owner sees ₱18,000 of cash and ₱0 of revenue.**

That is correct, and it is what Timely migrated _to_. But it is also the moment somebody decides the
system is broken — so the dashboard must show **cash and revenue side by side**, never one number
labelled "sales". That is a requirement on card 0012, arriving from an accounting standard rather than
from a design review.

### 5.5 Breakage, and one question this survey cannot answer

**[DOCS] Breakage is not optional.** KPMG Q7.6.15: an entity may _not_ elect to recognise it only at
expiry — "the guidance requires an entity to **estimate** the amount of breakage to which it expects to
be entitled."

**But whether an expired package balance may be recognised as revenue at all is a question of
Philippine escheat and unclaimed-property law, which was not researched.** ASC 606-10-55-49 and IFRS
15.B47 both say that where amounts are remittable to the state you recognise a **liability, not
revenue**. Zenoti ships this as a switch — "allow balances from expired packages to recognize as
revenue" — which is exactly the decision PH law would settle.

This is a question for whoever does the books, not a schema change, and it belongs on the plan's
**Still open** list beside the variance-band review.

---

## 6. Customer tabs

Answered in passing by §4.2 and §5.2, and the answer is that it needs **no new table**.

Odoo's `pay_later` payment method carries a `receivable_account_id` and is simply not flagged
`is_cash_count`, so deferred tenders are invisible to the drawer count automatically. Toast's house
account is the same idea, expressed as "close out orders as paid for sales reporting purposes while
deferring the payment towards the outstanding balance".

Here that is one more `payment_method` value — `'account'` — excluded from expected cash by the same
filter that already excludes `'package'`. A client's balance is
`Σ(method='account') − Σ(kind='settlement')`, derived rather than stored, which is what every surveyed
system does except the one that stores it and owns a consistency bug for it (§4.3).

**Not built until shadowing finds an actual tab.** The utang line is a candidate in field study §5 with
no decision against it, and this section exists so the cost is known rather than discovered.
