"use client";

import { useActionState, useId } from "react";

import { type ActionResult, grantExistingAccount, inviteStaff } from "./actions";

/**
 * Invite somebody, with their role decided here.
 *
 * Two things the research settled, both of them load-bearing rather than styling:
 *
 * **The role is chosen by the person sending the invitation, never by the person accepting it, and
 * it is assigned in the same step as the email** — so access is scoped from the first click rather
 * than existing unscoped for a window. That is a security boundary, and it is also why there is no
 * two-stage "invite, then set permissions" flow here.
 *
 * **Every role is described where it is assigned.** Not "Manager" but "Manager — their branch,
 * including money". A permission name is only meaningful to whoever wrote the matrix; the person
 * hiring a counter assistant needs the sentence.
 */
/**
 * The id of the visible "Add someone" heading, which names this form.
 *
 * Exported rather than duplicated: an `aria-label` here would be a second copy of a string a user
 * can read, free to drift from it - and it did, briefly, as "Invite somebody". The accessible name
 * should be the words on the screen.
 */
export const INVITE_HEADING_ID = "settings-invite-heading";

export function InviteForm({ branches }: { branches: readonly { id: string; label: string }[] }) {
  const [result, submit, pending] = useActionState<ActionResult | null, FormData>(
    inviteStaff,
    null,
  );
  /*
   * The second step, card 0040. Its own action and its own state, in its own form, because the offer
   * appears only after the invite has been refused and it submits different fields - the address and
   * the role and branch already chosen, with no name and no password.
   *
   * A separate `useActionState` rather than one shared with the invite: sharing would mean a grant's
   * result re-seeding the invite form's defaults, and a refusal from one clearing the other's message.
   */
  const [grantResult, grantExisting, granting] = useActionState<ActionResult | null, FormData>(
    grantExistingAccount,
    null,
  );
  /*
   * React calls `requestFormReset` before running a form action, unconditionally - so this form
   * empties itself on every submit, including the failures. Re-seeding the defaults from what the
   * action echoed back is what stops a rejected invite costing four retyped fields.
   */
  const prior = result?.submitted;
  const emailId = useId();
  const nameId = useId();
  const branchId = useId();

  const field =
    "h-pill w-full rounded-[10px] border border-border bg-card px-3.5 text-[14.5px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  const label = "block text-xs font-medium text-muted-foreground";

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      <form
        action={submit}
        aria-labelledby={INVITE_HEADING_ID}
        className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={emailId} className={label}>
            Email they will sign in with
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="ana@example.com"
            defaultValue={prior?.email ?? ""}
            className={field}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className={label}>
            Name <span className="font-normal">(optional)</span>
          </label>
          <input
            id={nameId}
            name="name"
            type="text"
            placeholder="Ana Reyes"
            defaultValue={prior?.name ?? ""}
            className={field}
          />
        </div>

        <fieldset className="flex flex-col gap-1.5">
          {/* A legend rather than a label, because this groups several controls. */}
          <legend className={label}>What they can do</legend>
          <div className="mt-0.5 flex flex-col gap-2">
            {[
              {
                value: "staff",
                title: "Staff",
                detail:
                  "Records sales and advances orders at their branch. Cannot see branch totals.",
              },
              {
                value: "manager",
                title: "Manager",
                detail: "Everything staff can do, plus branch totals, the daily close and exports.",
              },
            ].map((option) => (
              <label
                key={option.value}
                className="flex min-h-pill cursor-pointer items-start gap-3 rounded-[10px] border border-border p-3 has-checked:border-commit"
              >
                <input
                  type="radio"
                  name="role"
                  value={option.value}
                  required
                  defaultChecked={prior?.role === option.value}
                  className="mt-0.5 size-4 flex-none accent-commit"
                />
                <span>
                  <span className="block text-[14.5px] font-medium">{option.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {option.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {/*
           * Owner is absent by design, not omission: an owner grant is org-wide by constraint, so it
           * cannot be scoped to the branch this form collects, and handing over control of the
           * organisation should not share a button with hiring a counter assistant.
           */}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={branchId} className={label}>
            Branch
          </label>
          <select
            id={branchId}
            name="branchId"
            required
            defaultValue={prior?.branchId ?? ""}
            className={field}
          >
            <option value="">Choose a branch</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="h-commit w-full rounded-xl bg-commit text-[16px] font-semibold text-commit-foreground transition-opacity disabled:opacity-40"
        >
          {pending ? "Creating the account…" : "Create account and grant access"}
        </button>

        {/*
         * Always in the tree, so a result is an update to an existing live region rather than a new
         * one arriving with its text already in place - the insertion assistive tech announces least
         * reliably.
         *
         * Empty, it drops its own styling rather than being `hidden`: `display: none` would take it
         * back OUT of the accessibility tree, which is the exact problem this is fixing. With no
         * classes and no children a block element has no line box and no height, so it costs nothing
         * on screen while staying present to be updated.
         */}
        <div
          role="status"
          className={
            result
              ? `rounded-[10px] p-3 text-[13.5px] ${
                  result.ok
                    ? "bg-muted text-foreground"
                    : "bg-destructive-surface text-destructive-strong"
                }`
              : undefined
          }
        >
          {result && (
            <>
              <p>{result.message}</p>
              {result.tempPassword && (
                <div className="mt-2.5">
                  {/*
                   * Shown once and never again. The invite has no mailer behind it, so this string is
                   * the only way the person gets in - and if this screen is closed before it is read,
                   * the account is stranded until somebody issues a new password from the roster. The
                   * copy says so plainly rather than letting the owner discover it later.
                   */}
                  <p className="text-xs text-muted-foreground">
                    Their password. Write it down now &mdash; it is not shown again and no email is
                    sent.
                  </p>
                  <p className="mt-1 font-mono text-[15px] break-all select-all">
                    {result.tempPassword}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </form>

      {/*
       * The offer, and it is a sibling of the invite form rather than a child: a `<form>` cannot nest
       * inside another `<form>`, and this needs its own action.
       *
       * Rendered only when the invite refused BECAUSE the address is taken - `canGrantExisting` - and
       * hidden again once the grant succeeds, since the row it created is now on the roster above.
       */}
      {result?.canGrantExisting && !grantResult?.ok && (
        <form action={grantExisting} className="rounded-[10px] bg-muted p-3">
          <p className="text-[13.5px]">
            Give that account access instead? It keeps the password it already has, and no email is
            sent.
          </p>
          {/*
           * The address, role and branch the owner already chose, resent. Read from what the action
           * echoed back rather than from the fields, which React has already cleared.
           */}
          <input type="hidden" name="email" value={prior?.email ?? ""} />
          <input type="hidden" name="role" value={prior?.role ?? ""} />
          <input type="hidden" name="branchId" value={prior?.branchId ?? ""} />
          <button
            type="submit"
            disabled={granting}
            className="mt-2.5 min-h-pill rounded-[10px] border border-border bg-card px-4 text-[14px] font-medium disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {granting ? "Granting…" : "Grant access to the existing account"}
          </button>
        </form>
      )}

      {/* Its own live region, present before it has anything to say. */}
      <p
        role="status"
        className={
          grantResult
            ? `rounded-[10px] p-3 text-[13.5px] ${
                grantResult.ok
                  ? "bg-muted text-foreground"
                  : "bg-destructive-surface text-destructive-strong"
              }`
            : undefined
        }
      >
        {grantResult?.message}
      </p>
    </div>
  );
}
