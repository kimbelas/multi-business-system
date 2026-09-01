import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests. Playwright owns the browser; this owns everything that does not need one.
 *
 * `tests-e2e` is excluded explicitly - Playwright files also end in `.test.ts` shapes and
 * vitest would try to run them, failing on an import of `@playwright/test` that only makes
 * sense under its own runner.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    // `tests-rls` needs network, credentials and write access to a real project, so it is
    // `pnpm test:rls` and its own config. `pnpm test` stays hermetic.
    exclude: ["node_modules/**", ".next/**", ".open-next/**", "tests-e2e/**", "tests-rls/**"],
    /*
     * Capped, because the default derived one silently ran a SUBSET of the suite and exited 0.
     *
     * Three times on the development machine: once loudly, with eleven "Failed to start forks worker
     * / Timeout waiting for worker to respond" errors and `no tests`, and twice quietly, reporting
     * `10 passed (10)` and `149 passed (149)` where the suite is 11 files and 157 tests. Exit code 0
     * both times. The immediate re-run with a cap was complete, which is what identified the cause:
     * vitest spawned sixteen forks at roughly 880MB each on a machine already running another
     * project's dev server with a 12GB max-heap, and workers that never came up were not counted as
     * failures.
     *
     * A green suite that ran 94% of itself is the exact failure this project keeps finding in its own
     * code, arriving through the tooling instead. The cap belongs here rather than in a flag somebody
     * has to remember - `pnpm test` is what CI and a hook run, and neither passes flags.
     *
     * Four, not two: enough to keep the suite quick on a quiet machine, few enough to fit beside
     * something large. CI runners are unaffected in practice - the whole suite is two seconds of test
     * time and the cost is process startup.
     */
    maxWorkers: 4,
  },
});
