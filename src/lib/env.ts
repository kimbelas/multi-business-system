import "server-only";

/**
 * Every server-side variable, checked once at startup.
 *
 * Section 11 of the spec. A missing variable has to fail loudly and early, because the
 * alternative is discovering it at first use - and first use for `CRON_SECRET` is the cron
 * route rejecting every notification, which reads as a broken feature rather than an unset
 * value.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS completely, which is why this module starts with
 * `server-only`: importing it from a client component is then a build error rather than a
 * key in the browser bundle.
 */
const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
] as const;

type Required = (typeof REQUIRED)[number];

export function serverEnv(): Record<Required, string> & {
  SEMAPHORE_API_KEY: string | null;
  APP_TIMEZONE: string;
} {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}. Copy .env.example to .env.local, ` +
        `or set them with \`wrangler secret put\`.`,
    );
  }

  if ((process.env.CRON_SECRET ?? "").length < 32) {
    // Short enough to guess is the same as unset, and this one guards a public endpoint.
    throw new Error("CRON_SECRET must be at least 32 characters");
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    CRON_SECRET: process.env.CRON_SECRET!,
    // Optional in development: the SMS driver falls back to a no-op that logs.
    SEMAPHORE_API_KEY: process.env.SEMAPHORE_API_KEY ?? null,
    APP_TIMEZONE: process.env.APP_TIMEZONE ?? "Asia/Manila",
  };
}
