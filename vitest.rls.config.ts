import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The RLS persona suite, kept out of `pnpm test` on purpose.
 *
 * It needs network, credentials, and write access to a real Supabase project, so it is not
 * something a fresh clone or a pre-commit hook should run. `pnpm test` stays hermetic and fast;
 * this is `pnpm test:rls`.
 *
 * Serial, single-threaded, and generously timed out. Each persona is a real auth user and a
 * real sign-in round trip, and the fixture builds an org, three businesses, two branches and
 * four grants before the first assertion - parallel files would race on teardown and on the
 * project's rate limits.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests-rls/**/*.test.ts"],
    environment: "node",
    globals: true,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One place, so a failure is a policy failure rather than a race between two runs of the
    // same fixture against one project.
    maxConcurrency: 1,
  },
});
