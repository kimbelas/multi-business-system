import type { BusinessType } from "@/lib/business";

/**
 * Chart geometry.
 *
 * Deliberately plain numbers rather than `Pesos`. A bar height is presentation - a pixel is
 * not a peso, and no close is ever computed from one - so exact decimal arithmetic buys
 * nothing here and would make the geometry harder to read. Every *figure printed beside* a
 * chart still comes from `Pesos.toString()`; only the shapes come from these.
 */

export interface ChartSlice {
  readonly type: BusinessType;
  readonly value: number;
}

export interface ChartDay {
  readonly label: string;
  readonly slices: readonly ChartSlice[];
}

export function dayTotal(day: ChartDay): number {
  return day.slices.reduce((sum, s) => sum + s.value, 0);
}

/**
 * Each day's height as a percentage of the busiest day, so the tallest column is always 100%
 * and the chart never has a scale to read. Returns zeroes rather than dividing by zero on a
 * week with no sales at all, which is the state of every branch on its first day.
 */
export function columnPercents(days: readonly ChartDay[]): number[] {
  const totals = days.map(dayTotal);
  const max = Math.max(0, ...totals);
  if (max === 0) return totals.map(() => 0);
  return totals.map((t) => (t / max) * 100);
}

/**
 * Whole-number percentages that sum to exactly 100, by largest remainder.
 *
 * Rounding each share independently is the classic version of this and it produces 33/33/33
 * on an even three-way split - a share bar with a 1% gap in it, or three labels that visibly
 * do not add up. Everything gets floored first and the leftover points go to whichever shares
 * lost the most to flooring.
 *
 * An empty input, or one summing to zero, gets an empty result rather than a division: a day
 * with no sales has no split, and inventing one would draw a bar out of nothing.
 */
export function sharePercents(values: readonly number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return values.map(() => 0);

  const exact = values.map((v) => (v / total) * 100);
  const floored = exact.map(Math.floor);
  let remaining = 100 - floored.reduce((sum, v) => sum + v, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const out = [...floored];
  for (const { index } of order) {
    if (remaining <= 0) break;
    out[index] += 1;
    remaining -= 1;
  }
  return out;
}
