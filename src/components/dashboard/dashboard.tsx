import { ShareBar, type ShareRow, WeekChart } from "@/components/dashboard/charts";
import { BUSINESS_LABEL, businessColor } from "@/lib/business";
import type { ChartDay } from "@/lib/chart";
import { cn } from "@/lib/utils";

/**
 * The owner's screen. Server component throughout - nothing here has state, so nothing here
 * needs to reach the browser as JavaScript.
 *
 * Rule 2: the dashboard gains columns as it widens. 2x2 tiles become 4x1; the share bar loses
 * its figure rows once the table below carries them; the table appears from sm and moves
 * beside the chart at lg. The same data, arranged for the space.
 */

export interface Tile {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  /** `good` and `warn` are the only two directions a number is allowed to carry. */
  readonly tone?: "muted" | "good" | "warn";
}

export interface BusinessRow extends ShareRow {
  readonly transactions: number;
  /** Exact peso string, sign included, or null when the branch has not closed. */
  readonly variance: string | null;
}

function StatTile({ tile }: { tile: Tile }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 sm:p-4">
      <div className="text-xs text-muted-foreground">{tile.label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{tile.value}</div>
      <div
        className={cn(
          "mt-0.5 text-[11.5px]",
          tile.tone === "good" && "text-good",
          tile.tone === "warn" && "text-warn",
          (tile.tone ?? "muted") === "muted" && "text-muted-foreground",
        )}
      >
        {tile.note}
      </div>
    </div>
  );
}

function BusinessTable({ rows }: { rows: readonly BusinessRow[] }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:px-[18px]">
      <h2 className="mb-3 text-[12.5px] text-muted-foreground">By business</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-[11.5px] font-normal text-muted-foreground">
            <th className="pb-2.5 text-left font-normal">Business</th>
            <th className="pb-2.5 pl-4 text-right font-normal">Revenue</th>
            <th className="pb-2.5 pl-3 text-right font-normal">Tx</th>
            <th className="pb-2.5 pl-3 text-right font-normal">Variance</th>
            <th className="pb-2.5 pl-3 text-right font-normal">Close</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.type} className="border-t border-border">
              <td className="py-3 text-[14.5px] font-medium">
                <span
                  aria-hidden
                  className="mr-2.5 inline-block size-2.5 rounded-[3px] align-[-1px]"
                  style={{ backgroundColor: businessColor(row.type) }}
                />
                {BUSINESS_LABEL[row.type]}
              </td>
              <td className="py-3 pl-4 text-right font-mono text-[15px] tabular-nums">₱{row.amount}</td>
              <td className="py-3 pl-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
                {row.transactions}
              </td>
              <td
                className={cn(
                  "py-3 pl-3 text-right font-mono text-sm tabular-nums",
                  row.variance?.startsWith("-") ? "text-destructive-strong" : "text-muted-foreground",
                )}
              >
                {/* No colour bands, by decision: the figure and its sign only, until they are
                    set from two weeks of real closes. An em dash means nothing was counted. */}
                {row.variance ?? "—"}
              </td>
              <td className="py-3 pl-3 text-right text-[13px]">
                {row.closed ? (
                  <span className="text-muted-foreground">Closed</span>
                ) : (
                  <span className="font-semibold text-destructive-strong">Not closed</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CloseNotice({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  const subject = names.length === 1 ? `${names[0]} has` : `${names.join(", ")} have`;
  return (
    <div
      role="status"
      className="rounded-xl border border-destructive-border bg-destructive-surface p-3.5"
    >
      <div className="text-sm font-semibold text-destructive-strong">{subject} not closed</div>
      <div className="mt-0.5 text-[12.5px] text-destructive-strong/85">
        {names.length === 1 ? "Yesterday's drawer was never counted." : "Those drawers were never counted."}
      </div>
    </div>
  );
}

export function Dashboard({
  heading,
  total,
  subtitle,
  tiles,
  week,
  businesses,
}: {
  /** "Wednesday" on a phone, "Wednesday, 31 August" from sm up - passed in, not computed. */
  heading: string;
  total: string;
  subtitle: string;
  tiles: readonly Tile[];
  week: readonly ChartDay[];
  businesses: readonly BusinessRow[];
}) {
  const unclosed = businesses.filter((b) => !b.closed).map((b) => BUSINESS_LABEL[b.type]);

  return (
    <div data-testid="dashboard" className="flex flex-col gap-2.5 p-4 sm:gap-3.5 sm:p-6 lg:gap-4">
      <header className="sm:flex sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-[19px] font-semibold sm:text-[21px] lg:text-[22px]">{heading}</h1>
          <div className="mt-1 font-mono text-[2rem] font-semibold tabular-nums sm:hidden">
            ₱{total}
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground sm:mt-1 sm:text-[13px]">
            {subtitle}
          </p>
        </div>
        <div className="hidden font-mono text-[2.125rem] font-semibold tabular-nums sm:block lg:text-4xl">
          ₱{total}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 lg:gap-3.5">
        {tiles.map((tile) => (
          <StatTile key={tile.label} tile={tile} />
        ))}
      </div>

      {/* At lg the graphs take the left column and the table and notice take the right. Below
          that everything stacks in reading order: how the week went, then today, then why. */}
      <div className="flex flex-col gap-2.5 sm:gap-3.5 lg:flex-row lg:items-start lg:gap-5">
        <div className="flex flex-col gap-2.5 sm:gap-3.5 lg:flex-1">
          <WeekChart days={week} />
          <ShareBar rows={businesses} />
        </div>

        <div className="flex flex-col gap-2.5 sm:gap-3.5 lg:w-[440px] lg:flex-none">
          {/* No table on a phone: the share bar already carries the three figures, and a
              five-column table at 390px is a horizontal scroll nobody performs. */}
          <div className="hidden sm:block">
            <BusinessTable rows={businesses} />
          </div>
          <CloseNotice names={unclosed} />
        </div>
      </div>
    </div>
  );
}
