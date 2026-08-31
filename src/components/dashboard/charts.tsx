import { Peso } from "@/components/ui/peso";
import { Swatch } from "@/components/ui/swatch";
import { type BusinessType, businessColor, businessLabel } from "@/lib/business";
import { type ChartDay, columnPercents, sharePercents } from "@/lib/chart";
import { cn } from "@/lib/utils";

/**
 * The two graphs, both stacked by business.
 *
 * A single-series bar chart has nothing for colour to say. These are stacked, so the hue is the
 * only thing telling you which slice is which - it carries the information rather than
 * brightening the page, which is the whole reason colour is allowed here at all.
 *
 * Both are generic over the number of series: the day carries slices, the share bar carries
 * rows, and neither knows there are three businesses. A fourth is a registry entry and a
 * colour, not an edit here.
 *
 * No chart library. The Worker is capped at 3 MiB compressed and a stacked bar is flexbox;
 * recharts and friends are hundreds of kilobytes to draw a div with a height.
 */

function Legend({ types }: { types: readonly BusinessType[] }) {
  return (
    // Hidden on a phone, where the share bar underneath names all of them two inches lower. A
    // second instance of the chart to drop it would double the DOM.
    <ul className="hidden flex-wrap gap-3.5 sm:flex">
      {types.map((type) => (
        <li key={type} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Swatch type={type} />
          {businessLabel(type)}
        </li>
      ))}
    </ul>
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
  const types = days[0]?.slices.map((slice) => slice.type) ?? [];

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
              {/* column-reverse so the first slice sits at the bottom and the stack reads in
                  the same order as the legend. */}
              <div className="flex flex-col-reverse" style={{ height: `${percents[index]}%` }}>
                {day.slices.map((slice, sliceIndex) => (
                  <div
                    key={slice.type}
                    // The topmost slice is the last child in column-reverse, so that is where
                    // the cap goes. Rounding the first child rounds an interior edge.
                    className={sliceIndex === day.slices.length - 1 ? "rounded-t-[4px]" : undefined}
                    style={{
                      // Past days are the same hues dimmed: the week is context and today is
                      // the subject, and dimming says that without inventing a fourth colour.
                      // How far is a theme decision - fading toward near-black desaturates as
                      // well as darkens, so dark fades less - hence a token, not a number.
                      flex: `${slice.value} 1 0%`,
                      backgroundColor: businessColor(slice.type),
                      opacity: today ? 1 : "var(--chart-past)",
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
  /** Geometry only. Every figure printed comes from `amount`. */
  readonly value: number;
  /** Exact, from `Pesos.toString()`. */
  readonly amount: string;
  readonly closed: boolean;
}

export function ShareBar({ rows, className }: { rows: readonly ShareRow[]; className?: string }) {
  const percents = sharePercents(rows.map((row) => row.value));

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

      {/* From sm up the table below carries the figures, so all this adds is which hue is which
          share - without it the bar is a row of unlabelled colours. */}
      <ul data-testid="share-legend" className="mt-2 hidden flex-wrap gap-x-4 gap-y-1 sm:flex">
        {rows.map((row, index) => (
          <li
            key={row.type}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Swatch type={row.type} />
            {businessLabel(row.type)}
            <span className="font-mono text-foreground/80 tabular-nums">{percents[index]}%</span>
          </li>
        ))}
      </ul>

      {/* The figures are here only on a phone, which has no room for the table. */}
      <ul data-testid="share-figures" className="mt-2.5 sm:hidden">
        {rows.map((row, index) => (
          <li key={row.type} className="flex items-center gap-2.5 py-1.5">
            <Swatch type={row.type} />
            <span className="flex-1 text-[13.5px] font-medium">{businessLabel(row.type)}</span>
            <span
              className={cn(
                "mr-2.5 text-[11.5px]",
                row.closed ? "text-muted-foreground/70" : "font-semibold text-destructive-strong",
              )}
            >
              {row.closed ? "closed" : "not closed"}
            </span>
            <Peso amount={row.amount} className="text-sm font-semibold" />
            <span className="w-9 text-right font-mono text-[11.5px] text-muted-foreground/70 tabular-nums">
              {percents[index]}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
