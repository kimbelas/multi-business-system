import { defineConfig } from "@playwright/test";

/**
 * End-to-end, on the critical journeys only - section 15 of the spec.
 *
 * Two targets, one suite:
 *
 *   pnpm test:e2e                                            the local dev server
 *   PLAYWRIGHT_BASE_URL=https://... pnpm test:e2e:deployed   a deployed build
 *
 * With `PLAYWRIGHT_BASE_URL` set, no server is started - the point is to test the thing that is
 * already running. `deployed.spec.ts` is the file that means anything there; the rest drive
 * `/preview`, which is development-only by design, and skip themselves against a deployed
 * target rather than failing twenty-four times for the correct reason.
 *
 * The local default is `127.0.0.1` rather than `localhost`, and `next.config.ts` has to name it
 * in `allowedDevOrigins` for that to work: Next 16 counts the two as different hosts and returns
 * 403 for every client chunk otherwise, so the whole suite runs against a page that never
 * hydrates. It did, for a while, and the smoke test passed throughout.
 */
const DEPLOYED = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests-e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: DEPLOYED ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: DEPLOYED
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://127.0.0.1:3000",
        // Off in CI, because a half-dead server left by a cancelled run is adopted silently and
        // then fails in ways that look like real bugs.
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
