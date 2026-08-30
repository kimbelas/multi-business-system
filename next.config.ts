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
};

export default nextConfig;
