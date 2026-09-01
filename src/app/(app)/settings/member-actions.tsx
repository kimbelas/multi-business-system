"use client";

import { useActionState, useEffect, useId, useRef } from "react";

import { type ActionResult, grantOwner, reissuePassword, revokeGrant } from "./actions";

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
  orgLabel,
  canRemove,
  canReissuePassword,
  canGrantOwner,
  lastGrantHere,
  ownerRow,
  ownerCount,
}: {
  membershipId: string;
  userId: string;
  personLabel: string;
  whereLabel: string;
  orgLabel: string;
  /*
   * Which controls to offer is decided by `controlsFor` in `lib/roster-controls.ts`, not here.
   *
   * A role is a property of a row and the controls are a property of a person: once somebody is
   * promoted they hold two rows, and their branch row still says "manager" - so a per-row decision
   * would keep offering "New password" where `may_reissue_password` refuses every owner. That rule
   * needs the whole roster to answer, and it needs to be unit testable, so it lives in a pure module
   * and arrives here as booleans.
   */
  canRemove: boolean;
  canReissuePassword: boolean;
  canGrantOwner: boolean;
  lastGrantHere: boolean;
  ownerRow: boolean;
  ownerCount: number;
}) {
  const [revokeResult, revoke, revoking] = useActionState<ActionResult | null, FormData>(
    revokeGrant,
    null,
  );
  const [pwResult, reissue, reissuing] = useActionState<ActionResult | null, FormData>(
    reissuePassword,
    null,
  );
  const [grantResult, grant, granting] = useActionState<ActionResult | null, FormData>(
    grantOwner,
    null,
  );
  /*
   * Each dialog is named by its own heading. Without `aria-labelledby` a `<dialog>` is announced as
   * "dialog" with no name, and there are two of them per roster row - which is why the e2e suite had
   * to tell them apart by a button inside them. That was the symptom; this is the cause.
   */
  const removeTitleId = useId();
  const grantTitleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const grantDialog = useRef<HTMLDialogElement>(null);

  // Close on success only. A refusal — the last owner, a policy saying no — has to stay on screen,
  // because the message is the entire point of the interaction.
  useEffect(() => {
    if (revokeResult?.ok) dialog.current?.close();
  }, [revokeResult]);

  useEffect(() => {
    if (grantResult?.ok) grantDialog.current?.close();
  }, [grantResult]);

  const ghost =
    "flex min-h-pill items-center rounded-[10px] px-3 text-[13px] text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

  return (
    <>
      {/*
       * `flex-wrap` and not `flex-none`. A flex-none container's width is max-content, so it can
       * neither wrap nor shrink - which is how the two-button version measured 358px inside a 350px
       * row at 390px. There are three now, so this matters more than it did.
       */}
      <div className="flex flex-wrap items-center justify-end gap-1">
        {canReissuePassword && (
          <form action={reissue}>
            <input type="hidden" name="userId" value={userId} />
            <button
              type="submit"
              disabled={reissuing}
              aria-label={`Issue a new password for ${personLabel}`}
              className={ghost}
            >
              {reissuing ? "Setting…" : "New password"}
            </button>
          </form>
        )}
        {/*
         * The visible label is the verb; the accessible name says who and where.
         *
         * A four-person roster otherwise presents up to eight buttons called "Remove" and "Make
         * owner" in a screen reader's button list with nothing to tell them apart - the row is a
         * list item rather than a named region, so its context is not announced alongside them.
         */}
        {canGrantOwner && (
          <button
            type="button"
            aria-label={`Make ${personLabel} an owner of ${orgLabel}`}
            onClick={() => grantDialog.current?.showModal()}
            className={ghost}
          >
            Make owner
          </button>
        )}
        {canRemove && (
          <button
            type="button"
            aria-label={`Remove ${personLabel}'s access to ${whereLabel}`}
            onClick={() => dialog.current?.showModal()}
            className={ghost}
          >
            Remove
          </button>
        )}
      </div>

      {/*
       * Rendered whether or not there is a result. A polite live region has to exist before its
       * content changes to be announced reliably, and this one carries a temporary password - the
       * single most important thing on this screen to not silently miss.
       */}
      <p
        role="status"
        className={pwResult ? "mt-1.5 w-full text-xs text-muted-foreground" : undefined}
      >
        {pwResult?.message}
        {pwResult?.tempPassword && (
          <span className="mt-1 block font-mono text-[13.5px] break-all select-all text-foreground">
            {pwResult.tempPassword}
          </span>
        )}
      </p>

      <dialog
        ref={dialog}
        aria-labelledby={removeTitleId}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl bg-card p-5 shadow-card backdrop:bg-foreground/40"
      >
        <h2 id={removeTitleId} className="text-[17px] font-semibold">
          Remove {personLabel}&apos;s access?
        </h2>
        {/*
         * "can be given access again later" was false, and not only for owner rows.
         *
         * Nothing in this app grants a role to an account that already exists: `inviteStaff` creates
         * the account first and, on a duplicate email, answers "Grant them access instead of inviting
         * them again" - pointing at a control that does not exist. So removing somebody's ONLY grant
         * here cannot be undone from this screen, and the dialog said it could.
         *
         * It now says which of the two situations this is. The follow-up that would make the cheerful
         * version true is its own card: grant a role to an existing account, which is the same insert
         * `grantOwner` performs with a role and a branch instead of owner and null.
         */}
        <p className="mt-2 text-[14.5px] text-muted-foreground">
          They lose access to <span className="text-foreground">{whereLabel}</span> immediately.
          {ownerRow
            ? ` Removing an owner takes away everything they can see and do in ${orgLabel}. They are one of ${ownerCount} owners; the last one cannot be removed.`
            : lastGrantHere
              ? " They keep their account, but this is their only access here — and nothing on this screen can give it back, because their email address is already taken."
              : " They keep their account and their other access here."}
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

      {/*
       * Handing over the organisation. Every rule in this file's docstring applies unchanged - native
       * `<dialog>` with `showModal()`, Cancel first in the DOM so focus lands on the safe option, the
       * confirm button carrying the verb, and the `destructive-strong`/`destructive-surface` pair so
       * the label is readable in both themes.
       *
       * The destructive pair rather than the accent, and that is deliberate: `--commit` has three
       * enumerated places in the design and a fourth fill is exactly the drift the design doc exists
       * to stop. Handing somebody control of the business is consequential and cannot be taken back
       * alone, so the destructive emphasis is the honest one.
       */}
      <dialog
        ref={grantDialog}
        aria-labelledby={grantTitleId}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl bg-card p-5 shadow-card backdrop:bg-foreground/40"
      >
        <h2 id={grantTitleId} className="text-[17px] font-semibold">
          Make {personLabel} an owner of {orgLabel}?
        </h2>
        {/*
         * Three sentences doing three jobs, which is what criterion 2 asks for: what is handed over,
         * that it points back at the person granting it, and that it cannot be undone unilaterally.
         */}
        <p className="mt-2 text-[14.5px] text-muted-foreground">
          An owner sees every business, branch and peso in {orgLabel}, and can invite and remove
          people.
        </p>
        <p className="mt-2 text-[14.5px] text-muted-foreground">
          That includes you. Once {personLabel} is an owner they can remove your access, the same
          way you could remove theirs — and you cannot take this back on your own.
        </p>

        {grantResult && !grantResult.ok && (
          <p
            role="alert"
            className="mt-3 rounded-[10px] bg-destructive-surface p-3 text-[13.5px] text-destructive-strong"
          >
            {grantResult.message}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={granting}
            onClick={() => grantDialog.current?.close()}
            className="min-h-pill rounded-[10px] border border-border px-4 text-[14.5px] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Cancel
          </button>
          <form action={grant}>
            <input type="hidden" name="membershipId" value={membershipId} />
            <button
              type="submit"
              disabled={granting}
              className="min-h-pill rounded-[10px] bg-destructive-strong px-4 text-[14.5px] font-medium text-destructive-surface disabled:opacity-40"
            >
              {granting ? "Handing over…" : "Make them an owner"}
            </button>
          </form>
        </div>
      </dialog>

      {/*
       * Both confirmations' results, in a region that exists before either has anything to say.
       *
       * `revokeResult` was rendered NOWHERE. The action returns "Access removed." and the dialog
       * closes on success, so the only feedback was the row disappearing - and a refusal shown inside
       * the dialog. For anybody not watching that part of the screen, the most consequential action
       * here was silent.
       *
       * Only successes: a refusal stays inside its dialog, next to the button that caused it, which
       * is where the person is looking.
       */}
      <p
        role="status"
        className={
          revokeResult?.ok || grantResult?.ok
            ? "mt-1.5 w-full text-xs text-muted-foreground"
            : undefined
        }
      >
        {revokeResult?.ok ? revokeResult.message : null}
        {grantResult?.ok ? grantResult.message : null}
      </p>
    </>
  );
}
