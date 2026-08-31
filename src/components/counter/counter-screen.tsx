"use client";

import { useCallback, useEffect, useState } from "react";

import {
  AmountDisplay,
  Keypad,
  MethodPills,
  type PaymentMethod,
} from "@/components/counter/keypad-parts";
import { EMPTY, isCommittable, keyFromKeyboard, press, toPesos } from "@/lib/keypad";
import { cn } from "@/lib/utils";

/**
 * The sale screen, at all three widths.
 *
 * One component, three arrangements, no second layout - rule 6. The pad, the pills and the
 * commit button are byte-identical across breakpoints and always in that vertical order; what
 * changes is what sits *beside* them. Rule 1 is the `max-w-pad` on the pad column: extra width
 * buys context, not bigger keys.
 *
 * `onRecord` is a prop rather than a server action called from here, because the transactions
 * table does not exist yet - the phase 1 field-list gate blocks that migration. Everything on
 * this screen is finished except where the peso goes, and wiring it is one function.
 */

export interface SaleDraft {
  amount: string; // exact, from Pesos.toString()
  method: PaymentMethod;
  client: string;
  description: string;
}

export function CounterScreen({
  businessName,
  branchName,
  onRecord,
  recent,
  className,
}: {
  businessName: string;
  branchName: string;
  onRecord?: (draft: SaleDraft) => void;
  /** Today at this branch. Rendered as the third column at lg, and under the pad at sm. */
  recent?: React.ReactNode;
  className?: string;
}) {
  const [state, setState] = useState(EMPTY);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [client, setClient] = useState("");
  const [description, setDescription] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const ready = isCommittable(state);

  const record = useCallback(() => {
    const amount = toPesos(state);
    if (amount === null) return;
    onRecord?.({ amount: amount.toString(), method, client, description });
    setState(EMPTY);
    setClient("");
    setDescription("");
    setDetailsOpen(false);
  }, [client, description, method, onRecord, state]);

  /*
   * Rule 5: desktop adds a keyboard path, not a second layout. Digits type, Enter records,
   * Esc clears.
   *
   * The guard matters more than the mapping. Without it, typing a phone number into the client
   * field would also drive the amount, and every digit would land in two places at once.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Enter") {
        event.preventDefault();
        record();
        return;
      }
      const key = keyFromKeyboard(event.key);
      if (key === null) return;
      event.preventDefault();
      setState((current) => press(current, key));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [record]);

  const details = (
    <div className="flex flex-col gap-2.5">
      <input
        value={client}
        onChange={(event) => setClient(event.target.value)}
        placeholder="Client — search name or phone"
        aria-label="Client"
        className="h-pill w-full rounded-[10px] border border-border bg-card px-3.5 text-[14.5px] placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <input
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Description — optional"
        aria-label="Description"
        className="h-pill w-full rounded-[10px] border border-border bg-card px-3.5 text-[14.5px] placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
    </div>
  );

  return (
    <form
      data-testid="counter-screen"
      onSubmit={(event) => {
        event.preventDefault();
        record();
      }}
      className={cn(
        "flex flex-1 flex-col gap-4 p-4 sm:flex-row sm:items-start sm:gap-6 sm:p-6",
        className,
      )}
    >
      {/* Left: what the sale is. On mobile this is one line and a big number. */}
      <div className="flex flex-col gap-3.5 sm:flex-1">
        <div className="text-[13px] text-muted-foreground sm:hidden">
          {businessName} · {branchName}
        </div>

        <div className="sm:rounded-xl sm:border sm:border-border sm:bg-card sm:p-[18px]">
          <div className="hidden text-[12.5px] text-muted-foreground sm:block">Amount</div>
          <AmountDisplay state={state} className="text-right sm:mt-1 sm:text-left" />

          {/* The four-tap path never touches these. On a phone they stay behind one tap so
              nothing is unreachable there; from sm up there is room to show them outright. */}
          <div className="mt-3.5 hidden sm:block">{details}</div>
          {detailsOpen ? (
            <div className="mt-3.5 sm:hidden">{details}</div>
          ) : (
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="mt-1 text-[13px] text-muted-foreground underline underline-offset-4 sm:hidden"
            >
              Add client or note
            </button>
          )}
        </div>

        {recent ? <div className="hidden sm:block lg:hidden">{recent}</div> : null}
      </div>

      {/* Right: how the sale is entered. Capped, never stretched. */}
      <div className="flex w-full max-w-pad flex-col gap-3.5 sm:flex-none">
        <MethodPills value={method} onChange={setMethod} />
        <Keypad onPress={(key) => setState((current) => press(current, key))} />
        <button
          type="submit"
          disabled={!ready}
          className="h-commit w-full rounded-xl bg-commit text-[18px] font-semibold text-commit-foreground transition-opacity disabled:opacity-40"
        >
          Record sale
        </button>
        <p className="hidden text-center text-xs text-muted-foreground lg:block">
          Type digits on the keyboard. <span className="font-mono">Enter</span> records,{" "}
          <span className="font-mono">Esc</span> clears.
        </p>
      </div>

      {recent ? <div className="hidden w-[340px] flex-none lg:block">{recent}</div> : null}
    </form>
  );
}
