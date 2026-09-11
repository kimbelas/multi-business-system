"use server";

import { requireCapability } from "@/lib/authz";
import { isPaymentMethod, type PaymentMethod } from "@/lib/payment";
import { createClient } from "@/lib/supabase/server";

/**
 * Recording a sale — card 0005, and the one write that has to survive a bad connection.
 *
 * ## Why the client supplies the id
 *
 * A staff member on branch wifi taps Record, the request is slow, and they tap again. Or the phone
 * drops the response after the row was written. Either way the sale happened once and the person
 * cannot tell — so the second attempt must land on the same row rather than beside it. The client
 * mints one UUID per *attempt* and reuses it across retries; that id is the primary key, so the
 * database refuses the duplicate rather than the application noticing it.
 *
 * A conflict is therefore **success**, not an error. But only after re-reading the row through the
 * user's own session: RLS returns a staff member only their own transactions, so an id that belongs
 * to somebody else comes back as nothing and this refuses. That is what stops the idempotency key
 * from doubling as a way to probe for other people's sales.
 *
 * ## Why it re-authorizes
 *
 * A server action compiles to a POST endpoint on the page. The page's own guard protects the render
 * and not this, so the first statement is `requireCapability` again — with the branch id, because
 * `recordSale` is branch-scoped and the role that matters is the role *there*.
 *
 * The client says which branch; it never says who. `staff_id` comes from the session, and the RLS
 * insert policy requires it to equal `auth.uid()` — so attribution is enforced twice, once here for
 * a clear refusal and once in the database for the request that skips this code entirely.
 */

export interface Receipt {
  id: string;
  amount: string;
  method: PaymentMethod;
  occurredAt: string;
  staffName: string;
  branchName: string;
  /** True when this attempt found the sale already recorded — a retry that landed on its own row. */
  wasAlreadyRecorded: boolean;
}

export type SaleResult = { ok: true; receipt: Receipt } | { ok: false; message: string };

/** Exactly what a peso amount may look like arriving from a form. */
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordSale(input: {
  attemptId: string;
  branchId: string;
  amount: string;
  method: string;
  client?: string;
  description?: string;
}): Promise<SaleResult> {
  const scope = await requireCapability("recordSale", { branchId: input.branchId });

  if (!UUID.test(input.attemptId)) {
    return { ok: false, message: "That submission was malformed. Try recording it again." };
  }
  if (!AMOUNT.test(input.amount) || Number(input.amount) <= 0) {
    return { ok: false, message: "Enter an amount above zero." };
  }
  if (!isPaymentMethod(input.method)) {
    return { ok: false, message: "Choose a payment method." };
  }
  const method: PaymentMethod = input.method;

  // The branch is checked against what `loadScope` returned, which is what RLS returned - never
  // trusted from the request. `requireCapability` has already refused a branch outside it, so this
  // is a lookup for the name rather than a second gate.
  const branch = scope.businesses
    .flatMap((business) => business.branches)
    .find((candidate) => candidate.id === input.branchId);
  if (!branch) return { ok: false, message: "That branch is not one you can record against." };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      // DELIBERATELY BROKEN for one run: without the client id every submit is a new row.
      branch_id: input.branchId,
      staff_id: scope.userId,
      kind: "sale",
      amount: input.amount,
      payment_method: method,
      description: input.description?.trim() || null,
    })
    .select("id, amount, payment_method, occurred_at")
    .single();

  if (!error && data) {
    return {
      ok: true,
      receipt: {
        id: data.id as string,
        amount: String(data.amount),
        method: data.payment_method as PaymentMethod,
        occurredAt: data.occurred_at as string,
        staffName: scope.displayName,
        branchName: branch.name,
        wasAlreadyRecorded: false,
      },
    };
  }

  // 23505 is a duplicate key, which for this table means the attempt already landed.
  if (error?.code === "23505") {
    const { data: existing } = await supabase
      .from("transactions")
      .select("id, amount, payment_method, occurred_at")
      .eq("id", input.attemptId)
      .maybeSingle();

    // Nothing came back through the caller's own session, so the row is not theirs to see. Refuse
    // rather than report somebody else's sale as this one.
    if (!existing) {
      return { ok: false, message: "That sale could not be recorded. Enter it again." };
    }

    return {
      ok: true,
      receipt: {
        id: existing.id as string,
        amount: String(existing.amount),
        method: existing.payment_method as PaymentMethod,
        occurredAt: existing.occurred_at as string,
        staffName: scope.displayName,
        branchName: branch.name,
        wasAlreadyRecorded: true,
      },
    };
  }

  // 42501 is RLS refusing the insert, which at this point means the session disagrees with the
  // scope this action just read - a stale tab after a grant was revoked. Say so plainly.
  if (error?.code === "42501") {
    return { ok: false, message: "You no longer have access to record sales at this branch." };
  }

  return { ok: false, message: "That sale could not be recorded. Enter it again." };
}
