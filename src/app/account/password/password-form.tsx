"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { setPassword } from "./actions";
import { MIN_PASSWORD } from "./policy";

/**
 * Two fields and a confirmation, and a success panel rather than a redirect.
 *
 * The redirect was the first version: on success, send them to the app, where being inside is the
 * confirmation. It is not - somebody who has just typed a new password twice needs to be told it
 * took, especially the person who arrived here because they had lost the old one. So the panel
 * says so and offers the way in, which also gives the e2e suite something to assert other than a
 * URL that would look identical to a session that had silently failed to change anything.
 *
 * ## Why the fields are controlled, which they were not at first
 *
 * **React resets an uncontrolled form once its action completes** - including when the action
 * refused. So mistyping the confirmation cleared *both* boxes, and the e2e test that fixes the
 * confirmation and submits again found the password field empty, native validation blocking the
 * submit, and the previous error still on screen. The test looked wrong and the form was.
 *
 * `settings/invite-form.tsx` solves the same problem the other way, with `useActionState` and the
 * submitted values echoed back as `defaultValue`, and there is an e2e test pinning that behaviour.
 * That pattern is deliberately not copied here: it works by sending what was typed back down from
 * the server, which is the right trade for an email address and the wrong one for a credential.
 * Holding these two in component state keeps them in the browser except on submit, and costs
 * nothing else.
 */
export function PasswordForm() {
  const [password, setPasswordValue] = useState("");
  const [again, setAgain] = useState("");
  const [state, setState] = useState<{ ok: boolean; error: string | null }>({
    ok: false,
    error: null,
  });
  const [pending, startTransition] = useTransition();

  if (state.ok) {
    return (
      <div role="status" className="mt-8 rounded-xl border border-border p-4">
        <p className="text-sm font-medium">Password set</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          It replaces the old one immediately. Use it next time you sign in.
        </p>
        <Link
          href="/"
          className="mt-3 inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Continue
        </Link>
      </div>
    );
  }

  return (
    <form
      className="mt-8 flex flex-col gap-4"
      action={(formData) => {
        setState({ ok: false, error: null });
        startTransition(async () => {
          const result = await setPassword(formData);
          if ("error" in result) setState({ ok: false, error: result.error });
          else {
            /*
             * Cleared on success, not on refusal. The panel replaces the form either way, so this
             * is only about not leaving the value sitting in state behind it.
             */
            setPasswordValue("");
            setAgain("");
            setState({ ok: true, error: null });
          }
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(event) => setPasswordValue(event.target.value)}
          className="h-11 rounded-md border border-input bg-background px-3 text-base"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        New password again
        <input
          name="again"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={again}
          onChange={(event) => setAgain(event.target.value)}
          className="h-11 rounded-md border border-input bg-background px-3 text-base"
        />
      </label>

      <p className="text-sm text-muted-foreground">At least {MIN_PASSWORD} characters.</p>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Saving..." : "Set password"}
      </Button>
    </form>
  );
}
