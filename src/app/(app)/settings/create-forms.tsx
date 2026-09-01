"use client";

import { useActionState, useId } from "react";

import { BUSINESS, BUSINESS_TYPES } from "@/lib/business";

import { type ActionResult, createBranch, createBusiness } from "./actions";

/**
 * Add a business, or a branch inside one.
 *
 * Kept beside the list they extend rather than behind a separate screen: on a fresh organisation
 * this is the first thing that has to happen — the invite form cannot scope a grant without a
 * branch to scope it to — and on an established one it is used about twice a year. Neither case is
 * improved by a route of its own.
 *
 * Both forms are deliberately plain. A branch is a name and the business it belongs to; a business
 * is a name and one of three types. There is nothing here to design around, and the interesting
 * decisions all live in the actions.
 */

const field =
  "h-pill w-full rounded-[10px] border border-border bg-card px-3.5 text-[14.5px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const labelClass = "block text-xs font-medium text-muted-foreground";
const submit =
  "min-h-pill rounded-[10px] bg-commit px-4 text-[14.5px] font-medium text-commit-foreground transition-opacity disabled:opacity-40";

/*
 * On its own line, and allowed to break.
 *
 * Sharing a `flex items-center` row with the submit button gave this a flex base of min-content -
 * the longest unbroken token in the message - and a PostgREST error carries tokens like
 * `branches_business_org_fk`. At 390px that pushes the row past the card, which is the same
 * sideways scroll the roster row already had once on this screen.
 */
/*
 * The live region exists whether or not there is a result.
 *
 * A `role="status"` node that is inserted together with its text is the case assistive technology
 * handles worst: a polite region has to be in the accessibility tree BEFORE its content changes for
 * the change to be announced reliably. Returning null until there is something to say meant a blind
 * owner got no announcement of "Somebody already has an account with that email" - the message the
 * whole `submitted` echo-back in `actions.ts` exists to preserve.
 *
 * So the wrapper is always rendered and only the text swaps. Empty it collapses to nothing visible.
 */
function Result({ result }: { result: ActionResult | null }) {
  return (
    <p
      role="status"
      className={
        result
          ? `text-[13px] wrap-anywhere ${
              result.ok ? "text-muted-foreground" : "text-destructive-strong"
            }`
          : undefined
      }
    >
      {result?.message ?? ""}
    </p>
  );
}

export function CreateBusinessForm({
  organisations,
}: {
  /*
   * Every organisation this person owns. One means no question is asked and the action derives it;
   * several means the select below is the only way the action can be satisfied at all.
   *
   * Passed in rather than read here, because this is a client component and the names come from the
   * same query that names the header.
   */
  organisations: readonly { id: string; name: string }[];
}) {
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    createBusiness,
    null,
  );
  // Same reason as the invite form: React resets an uncontrolled form before the action runs, so
  // without this a refusal empties the field it is complaining about.
  const prior = result?.submitted;
  const nameId = useId();
  const titleId = useId();
  const orgSelectId = useId();
  const typeId = useId();

  return (
    <form
      action={action}
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card"
    >
      <h3 id={titleId} className="text-sm font-medium">
        Add a business
      </h3>

      {/*
       * Asked only when there is a choice. A select with one option is a question with one answer,
       * and `chooseOwnedOrg` ignores a value sent when none was asked for - a form that asked nothing
       * cannot have been answered.
       *
       * When it IS asked, no default is selected: an owner picking the wrong organisation because it
       * happened to be first is the failure this whole card is about, one step along.
       */}
      {organisations.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={orgSelectId} className={labelClass}>
            Organisation
          </label>
          <select id={orgSelectId} name="orgId" required defaultValue="" className={field}>
            <option value="" disabled>
              Choose one
            </option>
            {organisations.map((organisation) => (
              <option key={organisation.id} value={organisation.id}>
                {organisation.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className={labelClass}>
          Name
        </label>
        <input
          id={nameId}
          name="name"
          required
          placeholder="Laundry"
          defaultValue={prior?.name ?? ""}
          className={field}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={typeId} className={labelClass}>
          Type
        </label>
        {/*
         * The three the enum declares, labelled from `lib/business.ts` so this list cannot drift
         * from the one the rest of the app renders. A fourth type is a migration and a re-derived
         * palette, not a new option here - `--biz-none` exists because no fourth colour survives
         * all three dichromacies beside these.
         */}
        <select id={typeId} name="type" required defaultValue={prior?.role ?? ""} className={field}>
          <option value="">Choose a type</option>
          {BUSINESS_TYPES.map((type) => (
            <option key={type} value={type}>
              {BUSINESS[type].label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className={`${submit} self-start`}>
        {pending ? "Adding…" : "Add business"}
      </button>
      <Result result={result} />
    </form>
  );
}

export function CreateBranchForm({
  businesses,
}: {
  businesses: readonly { id: string; name: string }[];
}) {
  const [result, action, pending] = useActionState<ActionResult | null, FormData>(
    createBranch,
    null,
  );
  const prior = result?.submitted;
  const nameId = useId();
  const titleId = useId();
  const businessId = useId();

  if (businesses.length === 0) return null;

  return (
    <form
      action={action}
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card"
    >
      <h3 id={titleId} className="text-sm font-medium">
        Add a branch
      </h3>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={businessId} className={labelClass}>
          Business
        </label>
        <select
          id={businessId}
          name="businessId"
          required
          defaultValue={prior?.branchId ?? ""}
          className={field}
        >
          <option value="">Choose a business</option>
          {businesses.map((business) => (
            <option key={business.id} value={business.id}>
              {business.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className={labelClass}>
          Name
        </label>
        <input
          id={nameId}
          name="name"
          required
          placeholder="Main branch"
          defaultValue={prior?.name ?? ""}
          className={field}
        />
      </div>
      <button type="submit" disabled={pending} className={`${submit} self-start`}>
        {pending ? "Adding…" : "Add branch"}
      </button>
      <Result result={result} />
    </form>
  );
}
