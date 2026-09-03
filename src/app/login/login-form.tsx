"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { signIn } from "./actions";

/**
 * A client component only because it holds the error the action returns.
 *
 * The submit stays disabled while the action is in flight: a second submit of the same
 * credentials is a second auth request, and on a slow connection people press it.
 *
 * ## The email is controlled and the password is not, deliberately
 *
 * **React resets an uncontrolled form once its action completes,** refusals included - so
 * mistyping a password used to clear the email address as well, and the next attempt started from
 * an empty form. On the platform the brief calls primary that is an address retyped on a phone, at
 * a counter, because of a wrong character in a different field.
 *
 * Holding the email in state keeps it; leaving the password uncontrolled lets the same reset clear
 * it, which is what should happen to a credential that was just refused. `settings/invite-form.tsx`
 * reaches the same end for its own fields through `useActionState` and `defaultValue`, and has an
 * e2e test pinning it - the principle is the repository's, not this file's.
 *
 * Found by an e2e test that signed in twice: the second attempt failed with the password filled and
 * the email blank, which no unit test and no amount of reading this file would have shown.
 */
export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-8 flex flex-col gap-4"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await signIn(formData);
          if (result?.error) setError(result.error);
        });
      }}
    >
      <input type="hidden" name="next" value={next} />

      <label className="flex flex-col gap-1.5 text-sm">
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11 rounded-md border border-input bg-background px-3 text-base"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11 rounded-md border border-input bg-background px-3 text-base"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {/* h-11 throughout: this is used on a phone at a counter, and 44px is the tap target. */}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
