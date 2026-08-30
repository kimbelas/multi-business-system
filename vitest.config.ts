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
    exclude: ["node_modules/**", ".next/**", ".open-next/**", "tests-e2e/**"],
  },
});
