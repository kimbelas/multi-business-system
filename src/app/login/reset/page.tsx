import Link from "next/link";

import { ResetForm } from "./reset-form";

export const metadata = { title: "Reset your password" };

/**
 * Ask for a reset link. Public, because somebody who cannot sign in cannot be signed in to ask.
 *
 * It lives under `/login` rather than at a path of its own, and that is load-bearing: the
 * middleware treats `/login*` as public and also bounces a signed-in user away from it. Both are
 * right here - the first because this page has to be reachable without a session, the second
 * because somebody already inside should change their password from the app rather than through the
 * mail.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ stale?: string }>;
}) {
  const { stale } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We will email you a link to set a new one.
      </p>

      {/*
       * Where `/auth/confirm` sends a link it could not use. Phrased as a fact about the link
       * rather than as an error about the person: a reset link is single use and short lived, so
       * arriving here is ordinary - a second click on the same mail does it.
       */}
      {stale && (
        <p role="alert" className="mt-4 rounded-lg border border-border px-3.5 py-2.5 text-sm">
          That link has expired or had already been used. Ask for another one below.
        </p>
      )}

      <ResetForm />

      <Link
        href="/login"
        className="mt-6 self-start text-sm text-muted-foreground underline underline-offset-4"
      >
        Back to sign in
      </Link>
    </main>
  );
}
