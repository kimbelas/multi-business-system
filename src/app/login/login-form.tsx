"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { signIn } from "./actions";

/**
 * A client component only because it holds the error the action returns.
 *
 * The submit stays disabled while the action is in flight: a second submit of the same
 * credentials is a second auth request, and on a slow connection people press it.
 */
export function LoginForm({ next }: { next: string }) {
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
