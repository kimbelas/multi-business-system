import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * The default image optimizer is a Vercel service and fails on Cloudflare. This app has
   * almost no images, so turning it off is cheaper than a custom loader - section 2 of the
   * spec says exactly this.
   */
  images: { unoptimized: true },
  /*
   * A type error fails the build. There is no `eslint` key any more - Next 16 removed
   * `next lint`, and linting is `pnpm lint` running eslint directly. Leaving it here was a
   * hard build failure, not a warning.
   */
  typescript: { ignoreBuildErrors: false },
  /*
   * Next 16 blocks cross-origin requests to dev resources, and it treats `127.0.0.1` as a
   * different host from the allowed `localhost`. Without this, `next dev` serves the HTML
   * happily and returns 403 for every `/_next/static/chunks/*.js` - so the page renders and
   * then never hydrates. Nothing on screen says so.
   *
   * That matters here beyond convenience: `playwright.config.ts` points the whole e2e suite at
   * `http://127.0.0.1:3000`. Every test was driving an app with no JavaScript running, and the
   * smoke test passed because it only asks for HTTP 200 and a visible body. `tests-e2e/counter.spec.ts`
   * now asks a question that needs hydration to answer.
   *
   * Development only - the option has no effect on a build.
   */
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
