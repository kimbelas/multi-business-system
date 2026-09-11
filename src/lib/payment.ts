/**
 * The payment methods a sale may carry, in a module neither side owns.
 *
 * ## Why this is not in `components/counter/keypad-parts.tsx`, where it started
 *
 * That file is `"use client"`, and a server module importing a *value* from a client module does
 * not receive the value. Next replaces client exports with a client-reference proxy so it can be
 * serialised into the RSC payload, so `PAYMENT_METHODS` arrived in the sale action as an object
 * with no `includes`, and validating the method threw:
 *
 *   TypeError: {imported module ./keypad-parts.tsx}.PAYMENT_METHODS.includes is not a function
 *
 * **Typecheck and lint both passed**, because the types are entirely correct — the boundary is a
 * runtime substitution, not a type-level one. The first sign of it was a 500 on the page and a
 * "This page couldn't load" in an ARIA snapshot.
 *
 * The rule that avoids it: a constant shared across the server/client boundary lives in a module
 * with no directive at all. Types may cross freely, because they are erased; values may not.
 */

export const PAYMENT_METHODS = ["cash", "gcash", "maya"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Is this string one of the methods a sale may be recorded with? */
export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}
