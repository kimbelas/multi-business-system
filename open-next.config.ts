import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Defaults are deliberate. Incremental cache, tag cache and queue all have Cloudflare-backed
 * implementations, and every one of them adds a binding and a failure mode - none is needed
 * until something in this app actually revalidates on a schedule.
 */
export default defineCloudflareConfig();
