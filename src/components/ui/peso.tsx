import { cn } from "@/lib/utils";

/**
 * A peso figure. Mono, tabular, and the currency symbol in exactly one place.
 *
 * Two things it centralises, both of which were copied by hand eight times before this existed:
 *
 *  - **`tabular-nums`.** Without it the digits are proportionally spaced, so a column of
 *    amounts does not line up and a number being typed shuffles sideways as it grows. That is
 *    the single detail that makes a keypad feel unreliable.
 *  - **The symbol.** One `₱`, so a screen that needs to show something else later is one edit.
 *
 * `amount` is always an exact string from `Pesos.toString()`, never a number. A figure that
 * went through a float on the way to the screen is a figure that can disagree with the ledger
 * by a centavo, and the whole point of the daily close is that it does not.
 */
export function Peso({
  amount,
  className,
}: {
  /** Exact, from `Pesos.toString()` - grouping included by the caller if wanted. */
  amount: string;
  className?: string;
}) {
  return <span className={cn("font-mono tabular-nums", className)}>₱{amount}</span>;
}
