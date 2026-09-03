/**
 * The Worker bundle gate, as arithmetic that can be asserted.
 *
 * Card 0015. The brief's hardest constraint is a 3 MiB compressed Worker on the Workers free plan,
 * and its own words are that this has to be audited at every milestone rather than discovered at
 * the end. It was already a CI step; what it was not was a *budget*, and what it could not do was
 * fail for the right reason.
 *
 * ## Two thresholds, not one
 *
 * The old step compared against 3072 KiB - Cloudflare's own limit - so the only run it could fail
 * was one that would also have failed on deploy. A budget below the limit is the point: it fails in
 * review, with room still left, which is the difference between "we have a problem" and "we had a
 * problem an hour ago".
 *
 * ## Why this is a module and not four lines of awk
 *
 * Because the awk could not fail. It extracted the size with `awk -F"gzip:" ... | tr -dc "0-9."`,
 * and if that ever produced an empty string - the line reworded, the field moved, the unit changed -
 * awk coerced `""` to 0, printed `Worker:  KiB gzipped of 3072 KiB (0.0% used)` and exited 0. The
 * `grep -i "Total Upload"` in front of it checked that the line existed, not that a number came out
 * of it. Verified by running that exact program with an empty measurement: it passes.
 *
 * That is the fourth guard in this repository found unable to fire rather than wrong, so the
 * measurement is now something a unit test can feed a bad value to.
 */

/** Cloudflare's hard cap on the free plan, in KiB. Not ours to choose. */
export const HARD_LIMIT_KIB = 3072;

/**
 * Ours, and the number to argue about.
 *
 * The Worker measured 1403.63 KiB at commit f35e20d - 45.7% of the hard limit - with the framework,
 * the adapter and every screen built so far already in it. What is left to build is mostly
 * components rather than dependencies.
 *
 * 2048 was the first choice and it was wrong in a way worth recording: today's bundle is 68.5% of
 * it, so the warning below would start firing after 133 KiB of growth and be permanent noise for
 * the rest of the project. A threshold that is always tripped is not a threshold. 2560 puts today
 * at 54.8%, leaves about 516 KiB before the warning means something, fails half a mebibyte before
 * Cloudflare does, and can be lowered later - a budget is easier to tighten than to trust once it
 * has been ignored for a month.
 */
export const BUDGET_KIB = 2560;

/** Warn here, so shrinking headroom is visible before it is gone. */
export const WARN_FRACTION = 0.75;

export interface Verdict {
  readonly ok: boolean;
  /** `over-limit` and `over-budget` both fail; `warn` passes and says so. */
  readonly level: "ok" | "warn" | "over-budget" | "over-limit" | "unmeasured";
  readonly message: string;
}

/**
 * The gzipped size out of `wrangler deploy --dry-run`, or null when there isn't one.
 *
 * Null is a real answer and the caller must fail on it. That is the whole lesson of the awk this
 * replaces: no number has to be louder than a big number, because a parse that quietly yields
 * nothing is indistinguishable from a tiny bundle.
 *
 * The unit is required and converted rather than assumed. Wrangler prints KiB today, and a build
 * that grew past a mebibyte and started reporting `gzip: 2.5 MiB` would otherwise be read as 2.5
 * KiB - the one misparse that turns an over-limit bundle into the smallest number the gate has ever
 * seen.
 */
export function parseGzipKiB(output: string): number | null {
  if (!/total upload/i.test(output)) return null;

  const match = /gzip:\s*([\d.]+)\s*(KiB|MiB|KB|MB)/i.exec(output);
  if (!match) return null;

  const size = Number(match[1]);
  if (!Number.isFinite(size) || size <= 0) return null;

  return /^m/i.test(match[2]!) ? size * 1024 : size;
}

/** Format to one decimal without pulling in a locale. */
function oneDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function decide(
  gzipKiB: number | null,
  budgetKiB: number = BUDGET_KIB,
  hardLimitKiB: number = HARD_LIMIT_KIB,
): Verdict {
  if (gzipKiB === null) {
    return {
      ok: false,
      level: "unmeasured",
      message:
        "No compressed size could be read from the wrangler output. Failing rather than " +
        "passing: an unreadable measurement is not a small one.",
    };
  }

  const pctOfBudget = (gzipKiB / budgetKiB) * 100;
  const where =
    `Worker: ${oneDecimal(gzipKiB)} KiB gzipped — ` +
    `${oneDecimal(pctOfBudget)}% of the ${budgetKiB} KiB budget, ` +
    `${oneDecimal((gzipKiB / hardLimitKiB) * 100)}% of Cloudflare's ${hardLimitKiB} KiB limit`;

  if (gzipKiB > hardLimitKiB) {
    return {
      ok: false,
      level: "over-limit",
      message: `${where}. Over Cloudflare's hard limit: this would be refused on deploy.`,
    };
  }
  if (gzipKiB > budgetKiB) {
    return {
      ok: false,
      level: "over-budget",
      message:
        `${where}. Over our budget. There is still room under Cloudflare's limit, which is the ` +
        "point of failing here: raise the budget deliberately, or find the weight.",
    };
  }
  if (pctOfBudget > WARN_FRACTION * 100) {
    return {
      ok: true,
      level: "warn",
      message: `${where}. Over ${WARN_FRACTION * 100}% of the budget — headroom is going.`,
    };
  }
  return { ok: true, level: "ok", message: where };
}
