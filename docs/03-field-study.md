# Field study — what each business records today

This is the instrument for board card 0001, the one card that blocks another phase outright. No
migration in phase 2 is written until this document is filled in and every line in §5 is marked.

It is deliberately not a blank page. Every field the core schema can store is already listed, so the
visit is a matter of **marking what matches and writing what does not** rather than inventing a
structure while standing in a shop. §4 goes further and names the gaps that are already visible from
the schema — the things a laundry or a spa almost certainly records that this system currently cannot
hold. Those are the questions worth arriving with.

**Fill this in from observation, not from memory.** The card's last criterion says the gate is checked
by looking for the document, not by asking whether the visits happened — so a section left blank is a
section that blocks the migration, which is the intended behaviour.

---

## 1. One sale, as the system would store it

`transactions` is the same table for all three businesses. One row is one sale, one expense or one
refund — **not one item**. There is no line-item table, so "3 shirts and a blanket" is either one row
with a description or several rows.

| The schema stores                         | Where it comes from                     | What the current record captures | matches / must add / dropped |
| ----------------------------------------- | --------------------------------------- | -------------------------------- | ---------------------------- |
| `branch_id`                               | which branch                            |                                  |                              |
| `staff_id`                                | who recorded it                         |                                  |                              |
| `client_id` (optional)                    | which customer, if named                |                                  |                              |
| `kind`                                    | sale, expense or refund                 |                                  |                              |
| `amount`                                  | one total, must be > 0                  |                                  |                              |
| `payment_method`                          | cash, gcash, maya, bank_transfer, other |                                  |                              |
| `reference_no`                            | the GCash/Maya reference                |                                  |                              |
| `description`                             | free text                               |                                  |                              |
| `occurred_at`                             | when it happened                        |                                  |                              |
| `is_voided` / `void_reason` / `voided_by` | corrections                             |                                  |                              |

Ask, and write the answer down:

- **Who writes the record, and when?** At the moment of the sale, or at the end of the day from
  memory or from a pile of receipts?
- **What is written for a sale paid partly in cash and partly in GCash?** The schema holds one
  `payment_method` per row.
- **How is a mistake corrected today?** Crossed out and rewritten, or a second entry? The system will
  not allow an edit — a correction is a void plus a new transaction, by a manager or owner.
- **Is a sale ever recorded without a customer name?** Almost certainly yes; confirm.

---

## 2. The end-of-day cash routine — one branch, step by step

This is criterion 2, and one question in it decides a whole feature.

`daily_closes` stores: `close_date`, `expected_cash` (computed by the server), `declared_cash` (what
was counted), `variance` (generated, declared − expected), `notes`, `closed_by`. One row per branch per
date.

Write the routine as steps, in order, naming who does each:

1.
2.
3.
4.

Then answer these exactly:

- [ ] **Does the person counting know the expected figure before they count?** The system is built as a
      _blind_ close — count first, reveal after — so if the answer is yes today, that is a change in
      how people work and needs saying out loud rather than shipping as a surprise.
- [ ] Who counts — the staff member, the manager, or both?
- [ ] What happens today when the drawer is short? Who is told, and when?
- [ ] Is the float / starting cash recorded anywhere? **The schema has nowhere to put it.**
- [ ] Is the count recorded by denomination, or as one total? **The schema stores one total.**
- [ ] Does a branch ever close twice in a day — two shifts, two counts? Card 0018 exists for this and
      the answer decides whether it ships in the first migration.

---

## 3. One real laundry drop-off, traced intake to claim

Criterion 3. Follow one actual order through, and record the times.

`laundry_orders` stores: `transaction_id` (**required**), `ticket_no` (unique per branch),
`weight_kg`, `items_note`, `status` (received → washing → drying → folding → ready → claimed, or
cancelled), `ready_at`, `claimed_at`.

| Moment                        | What is written down today | Who writes it | On what (paper, book, phone) |
| ----------------------------- | -------------------------- | ------------- | ---------------------------- |
| Customer arrives with laundry |                            |               |                              |
| Money changes hands           |                            |               |                              |
| Order is weighed              |                            |               |                              |
| Order moves between stages    |                            |               |                              |
| Order is ready                |                            |               |                              |
| Customer returns and claims   |                            |               |                              |

And the question the card names specifically:

- [ ] **When the customer comes back without the ticket, how does staff find their order?** By name,
      by phone number, by remembering the bag, by looking through everything? Write down what actually
      happened, not what should happen.
- [ ] Is a ticket number written on the bag, on a slip, in a book, or all three?
- [ ] Are two customers ever given the same ticket number? What resets the numbering, and when?
- [ ] **Is the order ever taken before payment?** See §4 — the schema currently forbids it.

---

## 4. Gaps already visible from the schema

These are not guesses about the shops; they are things the schema **cannot store today**, which makes
them the likeliest "must add" lines. Arrive knowing them.

| Gap                                                                                                                                      | Why it matters                                                                                                                                                                                                                                                    | Already a card? |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Laundry taken before payment.** `laundry_orders.transaction_id` is `not null`, so an order cannot exist until money has changed hands. | If pay-on-claim happens at all, this is a column change now versus a backfill on the busiest table later. And an unpaid order must contribute nothing to that day's expected cash, or the blind close reports a variance that is an artefact of the payment mode. | Yes — 0017      |
| **Two shifts, two closes.** `unique (branch_id, close_date)` means a second close would have to reopen the first.                        | Reopening turns a submitted count into an editable one, which is the property the whole control depends on.                                                                                                                                                       | Yes — 0018      |
| **No line items.** One `amount` per transaction, `description` is free text.                                                             | If the paper record lists items and prices, that detail is lost unless something is added.                                                                                                                                                                        | No              |
| **No discounts, no tips.** Neither has a column.                                                                                         | A discounted sale can only be recorded as a smaller amount, so the discount itself is invisible.                                                                                                                                                                  | No              |
| **One payment method per sale.** No split payments.                                                                                      | A part-cash, part-GCash sale has to become two transactions, which changes what a "sale" means.                                                                                                                                                                   | No              |
| **No float / starting cash.** `expected_cash` is computed from transactions alone.                                                       | If the drawer starts with a float, every variance is wrong by that amount.                                                                                                                                                                                        | No              |
| **No denomination breakdown** on the count.                                                                                              | Fine if nobody records one; a loss if they do.                                                                                                                                                                                                                    | No              |
| **No service price list.** `appointments.service_name` is free text and there is no services table.                                      | Spa and skin care almost certainly have a fixed menu with prices.                                                                                                                                                                                                 | No              |
| **Clients belong to one business.** `clients.business_id`, not org-wide.                                                                 | The same person using the laundry and the spa is two records, with two phone numbers to keep current.                                                                                                                                                             | No              |
| **No breaks in attendance.** `clock_in`, `clock_out`, one open shift per person.                                                         | If hours are claimed net of an unpaid break, the system will overstate them.                                                                                                                                                                                      | No              |
| **No expenses detail.** `kind = 'expense'` shares the transaction shape.                                                                 | If expenses are recorded with a category or a supplier today, that is lost.                                                                                                                                                                                       | No              |

---

## 5. The decision list — the gate itself

Criterion 4: every field found in the current records that the core schema cannot store, marked by the
owner. This table is what the migration is checked against, and card 0026 does not start until every
row has a decision and a name against it.

| Field found | Business | must add / deliberately dropped | Owner's reasoning | Marked by |
| ----------- | -------- | ------------------------------- | ----------------- | --------- |
|             |          |                                 |                   |           |
|             |          |                                 |                   |           |
|             |          |                                 |                   |           |
|             |          |                                 |                   |           |
|             |          |                                 |                   |           |

**"Deliberately dropped" is a real answer and needs no defence beyond a sentence.** The point of
writing it down is that nobody rediscovers it as a bug in month three.

---

## 6. Sign-off

|                                    | Laundry | Spa | Skin care |
| ---------------------------------- | ------- | --- | --------- |
| Branch visited                     |         |     |           |
| Date                               |         |     |           |
| Observed by                        |         |     |           |
| §1 complete                        |         |     |           |
| §2 complete (one branch is enough) |         |     |           |
| §3 complete (laundry only)         |         |     |           |

Card 0001 closes when §5 has a decision against every line and this table names a branch and a date
for each business. Then, and not before, card 0026 writes the migrations.
