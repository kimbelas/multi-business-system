"use client";

import { useActionState, useEffect, useRef } from "react";

import { type ActionResult, reissuePassword, revokeGrant } from "./actions";

/**
 * Remove one grant, or issue a new password.
 *
 * ## Why revoking gets a dialog when the research says use undo
 *
 * For a reversible action, undo beats a confirmation: it keeps the intended case fast and taxes
 * nobody to protect a rare accident. Revoking a grant IS reversible — re-granting restores it.
 *
 * It gets a dialog anyway, because the consequence lands on somebody else. The person clicking
 * cannot observe what they took away: no toast tells the staff member at the other branch that
 * their access is gone, and an undo window they never see protects them not at all. "Ripple
 * effects on other people" is the exception the same research names.
 *
 * So the dialog follows the rest of that guidance exactly: it names the specific person and
 * branch, the destructive button carries the verb rather than "OK", and focus lands on Cancel.
 *
 * A native `<dialog>` with `showModal()`, because it gives focus trapping, Escape-to-close and
 * inertness for free — all things a hand-rolled overlay gets wrong. Focus landing on Cancel was
 * measured rather than assumed: after `showModal()` the active element is the Cancel button,
 * because it comes first in the DOM.
 *
 * The confirm button wears `text-destructive-surface`, not `text-white`. `--destructive-strong` is
 * a dark red in light mode and a LIGHT one in dark mode - white on it measures 8.36:1 and 1.92:1
 * respectively, so the label on a destructive confirmation was unreadable in dark. The two tokens
 * invert together, so pairing them holds in both: 7.64:1 and 8.47:1.
 */
export function MemberActions({
  membershipId,
  userId,
  personLabel,
  whereLabel,
}: {
  membershipId: string;
  userId: string;
  personLabel: string;
  whereLabel: string;
}) {
  const [revokeResult, revoke, revoking] = useActionState<ActionResult | null, FormData>(
    revokeGrant,
    null,
  );
  const [pwResult, reissue, reissuing] = useActionState<ActionResult | null, FormData>(
    reissuePassword,
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);

  // Close on success only. A refusal — the last owner, a policy saying no — has to stay on screen,
  // because the message is the entire point of the interaction.
  useEffect(() => {
    if (revokeResult?.ok) dialog.current?.close();
  }, [revokeResult]);

  const ghost =
    "flex min-h-pill items-center rounded-[10px] px-3 text-[13px] text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

  return (
    <>
      <div className="flex flex-none items-center gap-1">
        <form action={reissue}>
          <input type="hidden" name="userId" value={userId} />
          <button type="submit" disabled={reissuing} className={ghost}>
            {reissuing ? "Setting…" : "New password"}
          </button>
        </form>
        <button type="button" onClick={() => dialog.current?.showModal()} className={ghost}>
          Remove
        </button>
      </div>

      {pwResult && (
        <p role="status" className="mt-1.5 w-full text-xs text-muted-foreground">
          {pwResult.message}
          {pwResult.tempPassword && (
            <span className="mt-1 block font-mono text-[13.5px] break-all select-all text-foreground">
              {pwResult.tempPassword}
            </span>
          )}
        </p>
      )}

      <dialog
        ref={dialog}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl bg-card p-5 shadow-card backdrop:bg-foreground/40"
      >
        <h2 className="text-[17px] font-semibold">Remove {personLabel}&apos;s access?</h2>
        <p className="mt-2 text-[14.5px] text-muted-foreground">
          They lose access to <span className="text-foreground">{whereLabel}</span> immediately.
          They keep their account and can be given access again later.
        </p>

        {revokeResult && !revokeResult.ok && (
          <p
            role="alert"
            className="mt-3 rounded-[10px] bg-destructive-surface p-3 text-[13.5px] text-destructive-strong"
          >
            {revokeResult.message}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {/*
           * Cancel first in the DOM, so it takes focus when the dialog opens: the default landing
           * place is the safe option, never the destructive one. And the destructive button says
           * what it does rather than "OK", so the label alone is enough to know what is about to
           * happen.
           */}
          {/*
           * Disabled while the removal is in flight. Left enabled, "Cancel" closed the dialog
           * without cancelling anything: the action completed against the server regardless, so
           * the button did the opposite of what it says at the one moment somebody would reach for
           * it.
           */}
          <button
            type="button"
            disabled={revoking}
            onClick={() => dialog.current?.close()}
            className="min-h-pill rounded-[10px] border border-border px-4 text-[14.5px] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Cancel
          </button>
          <form action={revoke}>
            <input type="hidden" name="membershipId" value={membershipId} />
            <button
              type="submit"
              disabled={revoking}
              className="min-h-pill rounded-[10px] bg-destructive-strong px-4 text-[14.5px] font-medium text-destructive-surface disabled:opacity-40"
            >
              {revoking ? "Removing…" : "Remove access"}
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
