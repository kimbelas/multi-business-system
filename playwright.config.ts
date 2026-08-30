import { defineConfig } from "@playwright/test";

/**
 * End-to-end, on the critical journeys only - section 15 of the spec.
 *
 * The dev server is started here rather than expected to be running, so a fresh clone can
 * run the suite with one command. `reuseExistingServer` off in CI, because a half-dead server
 * left by a cancelled run is adopted silently and fails in ways that look like real bugs.
 */
export default defineConfig({
  testDir: "./tests-e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:3000", trace: "on-first-retry" },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
