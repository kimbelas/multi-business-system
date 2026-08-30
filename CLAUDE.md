# Multi Business System

Planned in Groundwork. This file is generated — edit the plan there, not here.

**Stage:** Planning · **Archetype:** Internal tool

---

## The brief

## What this is

A single web app for one owner running three small businesses in the Philippines — a
laundry shop, a massage/spa, and a skin care clinic — each with one or more branches
and employed staff.

The owner cannot be at every branch. The system's job is **visibility and
accountability**: what was sold, by whom, at which branch, and whether the declared
cash matches.

## Why it exists

- **Cash leakage.** Sales underreported at branches nobody is watching.
- **No cross-branch view.** Nothing shows three businesses in one place.
- **Laundry orders get lost** — washed but never marked ready, or mixed up.
- **Spa no-shows** from forgotten appointments.
- **Skin care clients quietly stop rebooking** and nobody notices in time.
- **Notebook and Excel records** — errors, and no audit trail when it matters.
- **Attendance disputes** with no record to settle them.

## What "working" looks like

- A cash sale is **four taps or fewer**, under 30 seconds. Staff will not use anything
  slower, and a system staff route around is worse than no system.
- The owner opens one screen on a phone and sees today and this week, all three
  businesses.
- Every peso is attributed to a person, a branch and a time.
- A daily close either matches or shows a variance — and the drawer is counted
  **before** the expected number is revealed.
- A laundry order is findable by ticket or phone, and its status is never ambiguous.

## Edges — deliberately not building

- **Payroll.** PH statutory payroll is out of scope. Attendance exports to CSV and
  whoever does payroll today keeps doing it.
- **BIR official receipts.** Acknowledgment slips and order tickets only. Nothing is
  ever labelled "Official Receipt" or "OR".
- **Offline mode** in v1. Entry is retry-friendly via idempotent server actions, but
  there is no service-worker sync.
- **Payment processing.** The system records that a cash/GCash/Maya payment happened,
  with a reference number. It never moves money.
- **Fine-grained permissions.** Three coarse roles — staff, manager, owner. No more.
- **Pay-on-claim laundry.** v1 is pay-at-intake only. Pay-on-claim is v2 and must not
  reshape the schema now.

## Decisions already made

- **Core plus extensions.** One sentence is the core schema: *a staff member at a
  branch performs a service for a client, and money changes hands at a point in time.*
  Business-specific tables are satellites referencing core by ID. A fourth business
  type is one extension table and one feature folder — zero core changes.
- **RLS is the only authorization layer.** The UI hides what a role cannot do; row-level
  security is what actually enforces it.
- **Notifications go through an outbox**, never sent inline. Laundry "ready", spa
  reminders and rebooking nudges all write one table with different template keys.
- **Money is numeric(12,2)**, never a float. Timestamps stored UTC, rendered Asia/Manila.
- **No self-signup.** The owner invites staff server-side.

- **Money is numeric(12,2)**, never a float. Timestamps stored UTC, rendered Asia/Manila.
- **No self-signup.** The owner invites staff server-side.

## Constraints that shape the build

- **Cloudflare Workers free plan caps a Worker at 3 MiB compressed.** This rules out
  heavy dependencies and has to be audited at every milestone, not discovered at the end.
- **Supabase free tier** during development: 500 MB, auto-pauses after 7 days idle.
  Launch needs Pro for no-pause and daily backups; until then a scheduled pg_dump.
- **Mobile-first, always.** The owner is on a phone. So is every staff member entering
  a sale.
- Next.js App Router on the **Node runtime** via @opennextjs/cloudflare — not the legacy
  edge adapter, and no `runtime = 'edge'` anywhere.

## Sequence

Eight milestones, each ending deployable with tests passing: scaffold → schema and RLS
→ auth and shell → money → laundry → attendance → dashboard → clients and
notifications → hardening and launch.

## Still open

- What variance threshold actually matters day to day? v1 hardcodes ₱0/₱50 amber, but
  nobody has watched a real close yet.
- Is 30 days the right "due for follow-up" window for skin care, or a guess?
- Semaphore is the assumed SMS provider. PH sender-ID registration takes time and has
  not been started.

## Phases

- **1. Shadow the notebook** — Write down how each of the three businesses records money, orders and hours today, before anything replaces it. The digital version has to beat a known baseline, not an imagined one.
- **2. Core plus extensions** — Scaffold, auth and the core schema with RLS. No migration is written until phase 1's field list exists. Three constraint changes land here — the optional payment link, the shift-aware close key, the open-shift index — and the branch and staff admin ships so the owner creates branches and invites people. The five-persona suite passes before any screen shows a peso.
- **3. Money** — A cash sale in four taps or fewer, every peso attributed to a person, a branch and a time, and a daily close that is counted before the expected number is revealed.
- **4. Laundry** — An order findable by ticket or phone whose status is never ambiguous, from intake through claim, with a board that makes a stuck order visible without looking for it.
- **5. Attendance and the owner's screen** — Hours recorded well enough to settle a dispute and exported for whoever does payroll today; one phone screen showing today and this week across all three businesses.
- **6. Clients, appointments and the outbox** — One notification table with template keys and a visible failure side; a list of skin care clients who have stopped coming back that someone actually works; and the smallest appointment entry that makes a T-24h reminder possible, pulled into v1 because no-shows are one of the reasons this is being built and nothing else in the plan addresses them.
- **7. Hardening and launch** — The security checklist, the four critical journeys under Playwright, a bundle budget that fails CI rather than being remembered, and a hand-off the owner and staff can use without the developer.

## The work

### Phase 1 — Shadow the notebook

- Write down how each business records a day today — High, Medium (To do)
- Watch three real closes before the variance threshold is fixed — High, Small (To do)
- Start the Semaphore sender-ID registration in phase 1 — High, Small (To do)

### Phase 2 — Core plus extensions

- Scaffold the app and prove the deploy pipeline — High, Medium (Backlog)
- Environment and secrets wired for local and for Workers — High, Small (Backlog)
- Make the laundry order's payment link optional before there is data — High, Medium (Backlog)
- Shift-aware close key: branch, date and shift number — High, Small (Backlog)
- Core migrations and generated types from the spec's schema — High, Large (Backlog)
- Seed script with a demo month of realistic data — Medium, Medium (Backlog)
- Five-persona RLS suite before any screen reads a peso — High, Large (Backlog)
- Login and session middleware, with no self-signup — High, Medium (Backlog)
- App shell that knows who you are and what you may see — High, Medium (Backlog)
- Business and branch switcher that survives three businesses on a phone — Medium, Medium (Backlog)
- Branch and staff admin the owner runs without the developer — High, Medium (Backlog)

### Phase 3 — Money

- Cash sale in four taps, counted on a real phone — High, Medium (Backlog)
- Blind daily close — count first, reveal after — High, Medium (Backlog)
- Expected cash as a pure function, with the Manila boundary tested — High, Medium (Backlog)
- Correction is a void plus a new transaction, never an edit — Medium, Small (Backlog)

### Phase 4 — Laundry

- Find a laundry order by phone, not only by ticket — High, Medium (Backlog)
- Forward-only status board that makes a stuck order obvious — High, Medium (Backlog)
- Ticket numbers from a per-branch counter, allocated inside the order's transaction — High, Medium (Backlog)

### Phase 5 — Attendance and the owner's screen

- Handle the forgotten clock-out — Medium, Small (Backlog)
- One phone screen for three businesses — High, Medium (Backlog)
- Attendance CSV with a column set chosen here, not discovered at payroll — Medium, Small (Backlog)

### Phase 6 — Clients, appointments and the outbox

- Outbox with a visible failure side — High, Medium (Backlog)
- Due-for-follow-up list that someone actually works — Medium, Medium (Backlog)
- Minimal appointment entry on the schema that already carries it — High, Large (Backlog)
- T-24h reminder as an outbox template, never a second send path — High, Medium (Backlog)

### Phase 7 — Hardening and launch

- Bundle budget as a CI gate, not a habit — Medium, Small (Backlog)
- Hand-off the owner and staff can use without the developer — Medium, Medium (Backlog)

## Settled questions

- Can a laundry order exist before money changes hands? The brief says pay-on-claim is v2 and must not reshape the schema, but the spec requires a transaction_id on every laundry order — so pay-on-claim later means altering that column and backfilling. → **pay is optional, depends on the settings of the user if comes first or not**
- Spa no-shows are one of the reasons for building this, but v1 has no booking UI and the T-24h reminder sits in the v2 backlog. Is the owner expecting fewer no-shows at launch? If so, what is the smallest thing that delivers it — a manually entered appointment plus one reminder? → **we should start those UI**
- When a customer comes back for their laundry without the ticket, what do staff ask for today — a name, a phone number, the day they dropped off? The answer decides whether intake must capture a phone, and that is a tap on the entry that has to stay at four. → **yes those are reuquired**
- If a staff member forgets to clock out, who may set the end time, and does the record show it was set after the fact? One open shift per person means the next clock-in fails until somebody decides. → **admin can set the clock out if none; leave it until set but still clock in can be set**
- What columns does whoever runs payroll need in the attendance CSV, and in what date format? A CSV that cannot be pasted into their existing sheet is the same as no export. → **your recommendation what's best**
- What does the notebook at each branch record today that the core schema has no column for — item counts, discounts, a running customer tab, who counts as a regular? Anything the current record holds and the system drops comes back as a workaround. → **Nothing is settled until the shadowing is done: the M1 migration does not start until a written field list exists from one branch of each business, with every field on it marked 'must add' or 'deliberately dropped'.**
- Is one close per branch per day right, or does a branch with two shifts need to close twice? The schema allows exactly one close per branch per date, so a second shift would have to reopen the first. → **Closes are per shift: the unique key becomes branch + date + shift number in M1, defaulting to shift 1 so a single-shift branch never sees the field. Making the key shift-aware is free before there is data and a migration plus backfill afterwards.**
- What variance is normal? v1 hard-codes ₱0 / ₱50 amber and nobody has watched a real close, so the first week could be all amber or all green and neither would mean anything. → **No threshold ships in week one: the close shows the variance figure and its sign only, and the amber and red bands are set from the first two weeks of real closes rather than guessed.**
- Which branches and which staff exist on day one — how many branches per business, and how many people need logins? There is no self-signup, so someone has to produce that list before auth is useful. → **The roster stops being a blocker: M2 ships the branch and staff admin from section 9.7, so the owner creates branches and invites people, and day one is whoever the owner has entered by then.**
- Is the ticket number branch-scoped and reset — A-0042 per branch, per day, per year? The schema makes it unique per branch and never says when it rolls over, so two tickets a year apart could collide or the sequence could run forever. → **The number is allocated from a per-branch counter row incremented in the same transaction as the order, which is the half that can actually break; the display format and its reset rule are branch configuration decided later.**
- Is 'pay is optional, depends on the settings of the user' a setting per branch, per business, or a choice the staff member makes on each order? A per-order choice is a decision at the counter inside the four-tap budget; a per-branch setting is not. The intake screen, the close and the expected-cash function each change with the answer. → **A per-branch setting. Where the branch does not allow pay-on-claim the intake screen is unchanged and costs no extra tap; where it does, intake shows a pay now / pay on claim toggle defaulted to pay now. Expected cash counts only transactions that exist, so an unpaid order contributes nothing until it is claimed and paid.**
- How much of the appointments UI is 'we should start those UI' — a manager entering an appointment plus one T-24h reminder, or therapist and room selection with a day view and rescheduling? And what comes out of the plan to pay for it, given that nothing has been removed and the milestone sequence priced none of it? → **The smallest thing that reduces no-shows: a manager enters client, therapist and time, and the T-24h reminder goes through the existing outbox. No day view, no drag rescheduling - changing an appointment is cancel and re-enter in v1. Nothing is removed to pay for it, so the launch date moves by roughly the size of that card rather than something else silently being dropped.**
- Does a spa appointment need a room, or is the therapist enough? The schema treats both as optional resources with separate overlap constraints, and nothing says who creates the room list or whether a branch with no rooms can book at all. If rooms are required, something in phase 2 has to ship an admin for them. → **The therapist is enough for v1. The room column stays in the schema unused and no rooms admin ships in phase 2; a branch with no rooms books normally. Rooms become real only when a branch says two therapists are competing for one, which is a v2 trigger, not a launch one.**
- What replaces one open shift per staff member? Permitting a second open shift makes the next morning's clock-in work and also permits one person to be clocked in twice at the same branch by mistake — the duplicate-hours dispute the index was there to prevent. One per person per branch per day, or a stale flag, are different migrations. → **The one-open-shift index stays. A clock-in closes any shift the person already has open, marks it auto-closed with no end time the person recorded, and surfaces it to the manager for correction. The morning clock-in therefore works, one person still cannot hold two open shifts, and the duplicate-hours dispute the index prevents stays prevented.**
- With no variance bands in week one, what does the owner's screen show instead — branches ordered by the size of the variance, or in a fixed order with the figure alongside? And who sets the bands after two weeks of closes, on what date? Nothing currently owns that review. → **Branches ordered by the absolute size of the variance, largest first, showing the figure and its sign with no colour at all. A card owns setting the bands, scheduled for fourteen days after the first branch goes live, and the owner sets them from the closes recorded by then.**
- Does the field-list gate block all of phase 2 or only its migrations? Scaffold, auth, the shell and the branch admin touch no business-specific field, so blocking them too costs a week for nothing — but starting the migration early is exactly what the gate exists to prevent. → **Only the migrations. Scaffold, auth, the shell and the branch and staff admin touch no business-specific field and start immediately; the field list gates the first migration that creates or alters a core table. Blocking the rest would cost a week and protect nothing.**

## Assumptions

- Every excerpt retrieved for this run is from a specification document — not one line of application code came back. This plan therefore assumes the repository is at or near M0 and that none of the schema quoted below exists yet as an applied migration. If any of it is already built, the cards for it are updates, not creates. (validated)
- The brief and the repository's spec are the same plan in two voices — the spec's problem table and constraints restate the brief's almost line for line. Where the spec adds detail the brief does not mention, that detail is taken here as already agreed rather than as an alternative worth re-proposing. (unvalidated)
- One person can hold different roles at different branches — the membership table is one grant per row, not one role per person. The shell and the RLS suite are assumed to handle that case rather than assuming a single role, because a manager covering another branch as staff is an ordinary thing in a three-business operation. (unvalidated)
- The 30-day follow-up window and the ₱0 / ₱50 variance thresholds are both placeholders that will turn out wrong. This plan assumes both become configurable before launch rather than after the first complaint, because changing either is otherwise a deploy. (unvalidated)
- A CSV export is the whole of the payroll interface, and this plan assumes whoever does payroll today can consume one without a column format being agreed first. That assumption is worth testing early — a CSV nobody can paste into their existing sheet leaves payroll exactly where it was, which is the one non-goal that has a person depending on it. (unvalidated)
- Nothing retrieved says what the Worker bundle currently measures, so the headroom under 3 MiB is unknown. This plan assumes there is room for the app plus copy-in components, and that the first real measurement happens at M0 rather than at M8 — if it is already tight, several later decisions change. (unvalidated)
- 'Pay is optional, depends on the settings of the user' is read here as a setting per branch. A per-order choice puts a decision at the counter inside the four-tap budget and makes expected cash depend on what a staff member picked rather than on how the branch operates. If it was meant per order, the intake screen, the close and the expected-cash function all change, and the card proposing the nullable column is sized wrong. (unvalidated)
- Starting the appointments UI is read here as the smallest entry that makes a reminder possible — a manager entering an appointment against a therapist and a room — not a customer-facing booking flow. The schema for both already exists, so the entire difference between the two readings is how much UI gets built, and this plan assumes the smaller one. (unvalidated)
- The attendance CSV column set in this plan is a recommendation taken up on the owner's answer, which means nobody who actually runs payroll has seen it. This assumes one export can be put in front of that person during the attendance phase, and that a column they cannot use is a change to a query rather than to the schema — true for every column proposed, and worth confirming before it stops being true. (unvalidated)
- Every excerpt retrieved for this run is still specification rather than application code, so nothing here confirms whether the schema has been applied. The three constraint changes this plan proposes — the nullable payment link, the shift-aware close key and the open-shift index — are assumed to be edits to a migration nobody has run. If any of them has already shipped, all three become a migration plus a backfill, their sizes are wrong, and the pay-on-claim cost the brief excluded has already been incurred. (unvalidated)

## Risks

- Pay-on-claim reshapes the schema after all. The brief rules it out of v1 on the condition that it does not reshape the schema now, but laundry_orders makes transaction_id NOT NULL — an order cannot exist before money changes hands. Adding pay-on-claim later is a column alteration plus a backfill on the busiest table in that business, which is the cost the exclusion was meant to avoid. — likelihood Medium, impact Medium. Mitigation: Decide during phase 2: either accept the v2 migration explicitly and record it against the backlog entry so it is priced, or make the column nullable now with a check constraint that requires it while pay-at-intake is the only mode.
- Spa no-shows are one of the seven reasons given for building this, and nothing in v1 addresses them. The appointments schema ships in v1 but the booking UI and the T-24h reminder automation both sit in the v2 backlog — so at launch there is nowhere for an appointment to be entered and nothing to remind anyone about. The owner may reasonably expect otherwise on day one. — likelihood High, impact Medium. Mitigation: Say plainly before M0 that no-shows are unaddressed in v1, or pull a minimal appointment entry plus one T-24h reminder into scope and re-plan the milestone that pays for it. Do not let the shipped schema imply a shipped feature.
- SMS sender-ID registration is not started and gates every notification in the plan. Laundry ready, reminders and rebooking nudges all depend on a Semaphore sender ID; PH registration takes time and the spec leaves it in the v2 backlog. The outbox can be finished, correct and tested, and still send nothing. — likelihood Medium, impact High. Mitigation: Start registration in phase 1, not phase 6 — it is paperwork that runs in parallel with everything. Ship the noop driver first so the pipeline is provable without it, and keep the failed-send view usable so a rejection is visible rather than silent.
- The four-tap rule loses to every feature that wants one more field. Phone capture for laundry lookup, client attribution for follow-ups, a payment reference for GCash — each is individually reasonable and each is a tap on the one entry that must stay at four. The erosion is invisible per commit and total by launch. — likelihood High, impact High. Mitigation: Count the taps on a real device at the end of every phase that touches entry, and treat a regression as a failing check rather than a note. Where a field cannot be dropped, make it optional and fillable later rather than mandatory at the counter.
- Both Supabase free-tier slots are spent before anything else needs one, and the dev project auto-pauses after seven days idle. Whoever returns after a quiet week meets a paused database, and there is no third slot for a staging or demo environment if one turns out to be wanted. — likelihood Medium, impact Medium. Mitigation: Keep the RLS and expected-cash suites running against a local Supabase so a paused hosted dev project never blocks work, and put the move to Pro on the launch checklist rather than after it.
- The blind close stops being blind without anything failing. Expected cash is computed server-side, and it is one convenient query away from being rendered into the same page as the close form — the screen would look correct, no test would go red, and the control the owner is relying on would simply be gone. — likelihood Medium, impact High. Mitigation: Assert it against the response body rather than the rendered page, and keep expected cash out of the close form's data path entirely until declared cash has been submitted, so the guarantee is structural rather than remembered.
- Two payment modes now meet on the money path. Pay is optional and set by the user's settings, so a laundry order can exist unpaid — and expected cash has two ways to be computed depending on when the money lands. The blind close is the control the owner is relying on, and an unpaid order counted at intake, or a claim-day payment counted twice, produces a variance nobody can explain at the one screen that has to be trusted above all others. — likelihood Medium, impact High. Mitigation: Make the payment mode an explicit input to the expected-cash pure function and cover both modes in its unit tests before either intake screen is built — including an order taken in one mode and claimed after the branch switched to the other, which is the case that will actually occur.
- Appointment entry and a T-24h reminder were added to v1 by answer, on top of a sequence of milestones that priced neither, and nothing was removed to pay for them. The spec still lists both as V2 and migrated the schema in v1 specifically so the UI could wait. The cost comes out of hardening or out of the launch date, and neither has been chosen — which usually means it comes out of hardening. — likelihood High, impact Medium. Mitigation: Decide before phase 2 what pays for it: a named cut from phases 5 to 7, or a launch date moved on the record. Ship the smallest booking that makes a reminder possible — one appointment, one therapist, one room — and hold the rest in v2 rather than letting the scope grow to fit the schema that already exists.
- The constraint that prevents duplicate open shifts gets dropped rather than replaced. Letting a staff member clock in while yesterday's shift is still open requires changing a partial unique index that permits one open shift per person, and the cheapest change is to delete it — which also removes the guard against one person accidentally holding two open shifts at the same branch on the same day. That is the duplicate-hours dispute the index existed to prevent, reintroduced while solving a different dispute. — likelihood Medium, impact Medium. Mitigation: Replace rather than drop. Decide the narrower constraint in phase 2 — one open shift per staff member per branch per day, or a flag distinguishing a stale shift from a live one — and write a test that tries to create the case the old index prevented and expects to fail.
- The variance bands are never set. No threshold ships in week one and the bands are to come from the first two weeks of real closes, but nothing in the plan schedules that review and no phase owns it. A screen showing a bare number works well enough that the omission is never felt, and the variance figure becomes a column nobody reads — which is the outcome the blind close was built to prevent, arriving by patience rather than by error. — likelihood Medium, impact Medium. Mitigation: Put the band-setting review on the launch checklist with a date rather than a phase, and have the dashboard state that no bands are set until they are, so the absence is on screen instead of being assumed away.

