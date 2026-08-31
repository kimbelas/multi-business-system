"use client";

import { type KeypadKey, type KeypadState, display } from "@/lib/keypad";
import { cn } from "@/lib/utils";

/**
 * The three pieces of the sale screen that a keypress touches, kept apart from the layout.
 *
 * All three are sized by the tokens rather than by numbers written here: `h-key`, `h-pill` and
 * `h-commit` come from `--key-h`, `--pill-h` and `--commit-h`, so a control that drops below
 * its floor fails `tests/design-tokens.test.ts` instead of shipping.
 */

export const PAYMENT_METHODS = ["cash", "gcash", "maya"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  gcash: "GCash",
  maya: "Maya",
};

export function AmountDisplay({
  state,
  className,
}: {
  state: KeypadState;
  className?: string;
}) {
  const { whole, fraction } = display(state);
  return (
    <output
      aria-label="Amount"
      className={cn(
        // Tabular figures so the number does not shuffle sideways as digits arrive - the one
        // thing that makes a keypad feel unreliable.
        "block font-mono text-5xl font-semibold tracking-tight tabular-nums sm:text-[2.75rem]",
        className,
      )}
    >
      ₱{whole}
      <span className="text-muted-foreground/60">{fraction}</span>
    </output>
  );
}

export function MethodPills({
  value,
  onChange,
}: {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Payment method" className="flex gap-2">
      {PAYMENT_METHODS.map((method) => {
        const selected = method === value;
        return (
          <button
            key={method}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(method)}
            className={cn(
              "h-pill flex-1 rounded-full text-[15px] transition-colors",
              selected
                // The accent hue at 28% lightness. Dark enough to read as ink, related
                // enough that the pad and Record sale look like one control group.
                ? "bg-commit-deep font-semibold text-white"
                : "border border-border bg-card text-foreground/70 hover:bg-muted",
            )}
          >
            {METHOD_LABEL[method]}
          </button>
        );
      })}
    </div>
  );
}

/** The pad itself. `.` and backspace share the bottom row with zero, as on a calculator. */
const LAYOUT: { key: KeypadKey; label: string; hint?: string }[] = [
  { key: "1", label: "1" },
  { key: "2", label: "2" },
  { key: "3", label: "3" },
  { key: "4", label: "4" },
  { key: "5", label: "5" },
  { key: "6", label: "6" },
  { key: "7", label: "7" },
  { key: "8", label: "8" },
  { key: "9", label: "9" },
  { key: ".", label: "." },
  { key: "0", label: "0" },
  { key: "backspace", label: "⌫", hint: "Backspace" },
];

export function Keypad({ onPress }: { onPress: (key: KeypadKey) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {LAYOUT.map(({ key, label, hint }) => (
        <button
          key={key}
          type="button"
          aria-label={hint ?? label}
          onClick={() => onPress(key)}
          // 62px at every width the pad appears at. Rule 4: nothing shrinks on a bigger
          // screen, because the front desk machine may well have a touchscreen too.
          className="h-key rounded-[12px] border border-border bg-card font-mono text-2xl font-medium transition-colors hover:bg-muted active:bg-muted"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
