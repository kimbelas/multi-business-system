import { BUSINESS_LABEL, type BusinessType, businessColor } from "@/lib/business";
import { type ChartDay, columnPercents, sharePercents } from "@/lib/chart";
import { cn } from "@/lib/utils";

/**
 * The two graphs, both stacked by business.
 *
 * A single-series bar chart has nothing for colour to say. These are stacked, so the hue is
 * the only thing telling you which slice is which - it carries the information rather than
 * brightening the page, which is the whole reason colour is allowed here at all.
 *
 * No chart library. The Worker is capped at 3 MiB compressed and a stacked bar is flexbox;
 * `recharts` and friends are hundreds of kilobytes to draw a `<div>` with a height.
 *
 * Colours arrive as `var(--chart-N)` through `businessColor`, so they flip in dark mode and
 * cannot be tree-shaken. See `src/lib/business.ts` for why they are not class names.
 */

function Legend({ types }: { types: readonly BusinessType[] }) {
  return (
    // Hidden on a phone, where the share bar underneath names all three businesses two
    // inches lower. A second instance of the chart to drop it would double the DOM.
    <div className="hidden flex-wrap gap-3.5 sm:flex">
      {types.map((type) => (
        <span key={type} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="size-2.5 rounded-[3px]"
            style={{ backgroundColor: businessColor(type) }}
          />
          {BUSINESS_LABEL[type]}
        </span>
      ))}
    </div>
  );
}

export function WeekChart({
  days,
  className,
}: {
  /** Oldest first. The last day is today. */
  days: readonly ChartDay[];
  className?: string;
}) {
  const percents = columnPercents(days);
  const types = days[0]?.slices.map((s) => s.type) ?? [];

  return (
    <section className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <header className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="text-[12.5px] text-muted-foreground">This week, by business</h2>
        <Legend types={types} />
      </header>

      <div className="flex h-[4.75rem] items-stretch gap-2 sm:h-36 lg:h-44">
        {days.map((day, index) => {
          const today = index === days.length - 1;
          return (
            <div key={day.label} className="flex h-full flex-1 flex-col justify-end gap-1.5">
              {/* column-reverse so the first slice sits at the bottom and the stack order
                  matches the legend order read downwards. */}
              <div className="flex flex-col-reverse" style={{ height: `${percents[index]}%` }}>
                {day.slices.map((slice, sliceIndex) => (
                  <div
                    key={slice.type}
                    // The topmost slice is the last child in column-reverse, so that is where
                    // the cap goes. Rounding the first child would round an interior edge.
                    className={sliceIndex === day.slices.length - 1 ? "rounded-t-[4px]" : undefined}
                    style={{
                      // Past days are the same hues dimmed: the week is context and today is
                      // the subject, and dimming says that without inventing a fourth colour.
                      flex: `${slice.value} 1 0%`,
                      backgroundColor: businessColor(slice.type),
                      opacity: today ? 1 : 0.45,
                    }}
                  />
                ))}
              </div>
              <div
                className={cn(
                  "text-center text-[11px]",
                  today ? "font-semibold text-foreground" : "text-muted-foreground/70",
                )}
              >
                {day.label}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export interface ShareRow {
  readonly type: BusinessType;
  readonly value: number;
  /** Exact, from `Pesos.toString()`. Only the bar geometry uses `value`. */
  readonly amount: string;
  readonly closed: boolean;
}

export function ShareBar({
  rows,
  className,
}: {
  rows: readonly ShareRow[];
  className?: string;
}) {
  const percents = sharePercents(rows.map((r) => r.value));

  return (
    <section className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <h2 className="mb-2.5 text-[12.5px] text-muted-foreground">Today&rsquo;s split</h2>

      <div className="flex h-3.5 gap-0.5">
        {rows.map((row, index) => (
          <div
            key={row.type}
            className={cn(
              index === 0 && "rounded-l-full",
              index === rows.length - 1 && "rounded-r-full",
            )}
            style={{ flex: `${percents[index]} 1 0%`, backgroundColor: businessColor(row.type) }}
          />
        ))}
      </div>

      {/* From sm up the table below carries the figures, so all this needs to add is which
          hue is which share - without it the bar was three unlabelled colours. */}
      <ul data-testid="share-legend" className="mt-2 hidden flex-wrap gap-x-4 gap-y-1 sm:flex">
        {rows.map((row, index) => (
          <li
            key={row.type}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              aria-hidden
              className="size-2.5 rounded-[3px]"
              style={{ backgroundColor: businessColor(row.type) }}
            />
            {BUSINESS_LABEL[row.type]}
            <span className="font-mono tabular-nums text-foreground/80">{percents[index]}%</span>
          </li>
        ))}
      </ul>

      {/* The figures are here only on a phone, which has no room for the table. */}
      <ul data-testid="share-figures" className="mt-2.5 sm:hidden">
          {rows.map((row, index) => (
            <li key={row.type} className="flex items-center gap-2.5 py-1.5">
              <span
                aria-hidden
                className="size-2.5 flex-none rounded-[3px]"
                style={{ backgroundColor: businessColor(row.type) }}
              />
              <span className="flex-1 text-[13.5px] font-medium">{BUSINESS_LABEL[row.type]}</span>
              <span
                className={cn(
                  "mr-2.5 text-[11.5px]",
                  row.closed ? "text-muted-foreground/70" : "font-semibold text-destructive-strong",
                )}
              >
                {row.closed ? "closed" : "not closed"}
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums">₱{row.amount}</span>
              <span className="w-9 text-right font-mono text-[11.5px] text-muted-foreground/70 tabular-nums">
                {percents[index]}%
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}
