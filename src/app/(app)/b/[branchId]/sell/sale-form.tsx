"use client";

import { useCallback, useRef, useState, useTransition } from "react";

import { CounterScreen, type SaleDraft } from "@/components/counter/counter-screen";
import { Pesos } from "@/lib/money";

import { recordSale, type Receipt } from "./actions";

/**
 * The client half of the counter: the screen that already existed, joined to the action.
 *
 * `CounterScreen` was finished before the transactions table was, with `onRecord` left as a prop
 * and a note saying wiring it was one function. This is that function, plus the two things a
 * screen at a counter needs that a design preview did not: a confirmation somebody can read at
 * arm's length, and a retry that cannot bill a customer twice.
 *
 * ## The attempt id is minted once per sale, not once per tap
 *
 * Held in a ref rather than state, because a re-render must not change it — that is the whole
 * point. It is created on the first submit and cleared only once the server has confirmed, so a
 * double-tap, a slow network and a browser retry all carry the same id and all land on the same
 * row. `actions.ts` treats the duplicate-key error as success.
 *
 * `useTransition` also gates the button while a submit is in flight, which stops most double-taps
 * before they leave the phone — but it is the belt, not the braces. A dropped response leaves the
 * button enabled with the row already written, and only the id saves that case.
 */
export function SaleForm({
  branchId,
  businessName,
  branchName,
}: {
  branchId: string;
  businessName: string;
  branchName: string;
}) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const attemptId = useRef<string | null>(null);

  const onRecord = useCallback(
    (draft: SaleDraft) => {
      if (pending) return;
      attemptId.current ??= crypto.randomUUID();
      const id = attemptId.current;
      setError(null);

      startTransition(async () => {
        const result = await recordSale({
          attemptId: id,
          branchId,
          amount: draft.amount,
          method: draft.method,
          client: draft.client,
          description: draft.description,
        });
        if (result.ok) {
          attemptId.current = null;
          setReceipt(result.receipt);
        } else {
          // The id deliberately survives a failure: if the row did land and only the response was
          // lost, the next attempt has to reuse it.
          setError(result.message);
        }
      });
    },
    [branchId, pending],
  );

  if (receipt) {
    return (
      <Confirmation
        receipt={receipt}
        onNext={() => {
          setReceipt(null);
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {error ? (
        <p
          role="status"
          data-testid="sale-error"
          className="mx-4 mt-4 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[14.5px] text-destructive sm:mx-6"
        >
          {error}
        </p>
      ) : null}
      <CounterScreen
        businessName={businessName}
        branchName={branchName}
        onRecord={onRecord}
        className={pending ? "pointer-events-none opacity-60" : undefined}
      />
    </div>
  );
}

/**
 * What the counter shows once the money is in the drawer.
 *
 * Large enough to read without picking the phone up, and it names the three things the card says a
 * completed sale must show: who, where, when. None of them are editable here or anywhere - the
 * database refuses an update to any of them, so this is a statement rather than a form.
 */
function Confirmation({ receipt, onNext }: { receipt: Receipt; onNext: () => void }) {
  const amount = Pesos.from(receipt.amount);
  const at = new Date(receipt.occurredAt);
  const time = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
  const day = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "short",
  }).format(at);

  return (
    <div
      data-testid="sale-confirmation"
      className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center"
    >
      <div className="flex flex-col items-center gap-2">
        <p className="text-[13px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {receipt.wasAlreadyRecorded ? "Already recorded" : "Recorded"}
        </p>
        <p className="text-[44px] leading-none font-semibold tabular-nums sm:text-[56px]">
          ₱{amount.toString()}
        </p>
        <p className="text-[15px] text-muted-foreground capitalize">{receipt.method}</p>
      </div>

      <dl className="grid w-full max-w-xs grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-left text-[14.5px]">
        <dt className="text-muted-foreground">By</dt>
        <dd>{receipt.staffName}</dd>
        <dt className="text-muted-foreground">At</dt>
        <dd>{receipt.branchName}</dd>
        <dt className="text-muted-foreground">When</dt>
        <dd>
          {time} · {day}
        </dd>
      </dl>

      {receipt.wasAlreadyRecorded ? (
        <p className="max-w-xs text-[13.5px] text-muted-foreground">
          This sale was already saved — the second attempt found it rather than adding another.
        </p>
      ) : null}

      <button
        type="button"
        onClick={onNext}
        autoFocus
        className="h-pill min-h-[48px] w-full max-w-xs rounded-[10px] bg-primary px-6 text-[15px] font-semibold text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        New sale
      </button>
    </div>
  );
}
