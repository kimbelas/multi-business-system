"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { requestReset } from "./actions";

/**
 * A client component for the same reason `LoginForm` is one: it holds what the action returned.
 *
 * The sent state replaces the form rather than sitting under it. Leaving the field there invites a
 * second submit, and a second submit inside the mailer's rate window sends nothing while looking
 * exactly like the first - so the screen would be teaching people to do the thing that fails.
 */
export function ResetForm() {
  const [state, setState] = useState<{ sent: boolean; error: string | null }>({
    sent: false,
    error: null,
  });
  const [pending, startTransition] = useTransition();

  if (state.sent) {
    return (
      <div role="status" className="mt-8 rounded-xl border border-border p-4">
        <p className="text-sm font-medium">Check your email</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          If that address has an account here, a link to set a new password is on its way. The link
          works once and expires within the hour.
        </p>
        {/* The rate-limited case, said as advice rather than as an error - see actions.ts. */}
        <p className="mt-2.5 text-sm text-muted-foreground">
          Nothing after a few minutes? Ask the owner to issue you a new password instead.
        </p>
      </div>
    );
  }

  return (
    <form
      className="mt-8 flex flex-col gap-4"
      action={(formData) => {
        setState({ sent: false, error: null });
        startTransition(async () => {
          const result = await requestReset(formData);
          if ("error" in result) setState({ sent: false, error: result.error });
          else setState({ sent: true, error: null });
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="h-11 rounded-md border border-input bg-background px-3 text-base"
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Sending..." : "Send the link"}
      </Button>
    </form>
  );
}
