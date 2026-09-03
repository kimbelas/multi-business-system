import Link from "next/link";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

/**
 * The only public page. Middleware sends everything else here, carrying `next` so signing in
 * returns to where the person was going rather than to a generic home.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Ask the owner for an account. There is no self-signup.
      </p>
      <LoginForm next={next ?? "/"} />

      {/*
       * Under the button rather than beside the password field, and outside the client component
       * on purpose - it is a link, not a control the form's state has anything to say about.
       *
       * It is also the sentence that makes another one true: `reissuePassword` refuses anybody who
       * has ever signed in, and tells the owner "Anyone who has used their account resets it
       * themselves". Until this existed there was nowhere for them to do it.
       */}
      <Link
        href="/login/reset"
        className="mt-6 self-start text-sm text-muted-foreground underline underline-offset-4"
      >
        Forgot your password?
      </Link>
    </main>
  );
}
