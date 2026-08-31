import { ShareBar, type ShareRow, WeekChart } from "@/components/dashboard/charts";
import { Peso } from "@/components/ui/peso";
import { Swatch } from "@/components/ui/swatch";
import { businessLabel } from "@/lib/business";
import type { ChartDay } from "@/lib/chart";
import { cn } from "@/lib/utils";

/**
 * The owner's screen. Server component throughout - nothing here has state, so nothing here
 * needs to reach the browser as JavaScript.
 *
 * Rule 2: the dashboard gains columns as it widens. 2x2 tiles become 4x1; the share bar drops
 * its figure rows once the table carries them; the table appears from sm and moves beside the
 * graphs at lg. The same data, arranged for the space.
 *
 * Every list here is driven by its prop and none of them counts to three.
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

const TILE_TONE = {
  muted: "text-muted-foreground",
  good: "text-good",
  warn: "text-warn",
} as const;

function StatTile({ tile }: { tile: Tile }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 sm:p-4">
      <div className="text-xs text-muted-foreground">{tile.label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{tile.value}</div>
      <div className={cn("mt-0.5 text-[11.5px]", TILE_TONE[tile.tone ?? "muted"])}>{tile.note}</div>
    </div>
  );
}

/** Declared once so the header and the body cannot drift apart. */
const COLUMNS = ["Business", "Revenue", "Tx", "Variance", "Close"] as const;

function BusinessTable({ rows }: { rows: readonly BusinessRow[] }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:px-[18px]">
      <h2 className="mb-3 text-[12.5px] text-muted-foreground">By business</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-[11.5px] text-muted-foreground">
            {COLUMNS.map((column, index) => (
              <th
                key={column}
                className={cn(
                  "pb-2.5 font-normal",
                  index === 0 ? "text-left" : "pl-3 text-right",
                  index === 1 && "pl-4",
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.type} className="border-t border-border">
              <td className="py-3 text-[14.5px] font-medium">
                <Swatch type={row.type} className="mr-2.5 inline-block align-[-1px]" />
                {businessLabel(row.type)}
              </td>
              <td className="py-3 pl-4 text-right">
                <Peso amount={row.amount} className="text-[15px]" />
              </td>
              <td className="py-3 pl-3 text-right font-mono text-sm text-muted-foreground tabular-nums">
                {row.transactions}
              </td>
              <td
                className={cn(
                  "py-3 pl-3 text-right font-mono text-sm tabular-nums",
                  row.variance?.startsWith("-")
                    ? "text-destructive-strong"
                    : "text-muted-foreground",
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
  const one = names.length === 1;
  return (
    <div
      role="status"
      className="rounded-xl border border-destructive-border bg-destructive-surface p-3.5"
    >
      <div className="text-sm font-semibold text-destructive-strong">
        {one ? `${names[0]} has` : `${names.join(", ")} have`} not closed
      </div>
      <div className="mt-0.5 text-[12.5px] text-destructive-strong/85">
        {one ? "Yesterday's drawer was never counted." : "Those drawers were never counted."}
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
  /** Passed in, not computed - the timezone rules live on the server, not in a component. */
  heading: string;
  total: string;
  subtitle: string;
  tiles: readonly Tile[];
  week: readonly ChartDay[];
  businesses: readonly BusinessRow[];
}) {
  const unclosed = businesses.filter((row) => !row.closed).map((row) => businessLabel(row.type));

  return (
    <div data-testid="dashboard" className="flex flex-col gap-2.5 p-4 sm:gap-3.5 sm:p-6 lg:gap-4">
      <header className="sm:flex sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-[19px] font-semibold sm:text-[21px] lg:text-[22px]">{heading}</h1>
          <Peso amount={total} className="mt-1 block text-[2rem] font-semibold sm:hidden" />
          <p className="mt-0.5 text-[12.5px] text-muted-foreground sm:mt-1 sm:text-[13px]">
            {subtitle}
          </p>
        </div>
        <Peso amount={total} className="hidden text-[2.125rem] font-semibold sm:block lg:text-4xl" />
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
          {/* No table on a phone: the share bar already carries the figures, and a five-column
              table at 390px is a horizontal scroll nobody performs. */}
          <div className="hidden sm:block">
            <BusinessTable rows={businesses} />
          </div>
          <CloseNotice names={unclosed} />
        </div>
      </div>
    </div>
  );
}
