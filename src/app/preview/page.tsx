import { notFound } from "next/navigation";

import { CounterScreen } from "@/components/counter/counter-screen";
import { Dashboard, type BusinessRow, type Tile } from "@/components/dashboard/dashboard";
import { AppShell, type BusinessLink } from "@/components/shell/app-shell";
import { Peso } from "@/components/ui/peso";
import type { ChartDay } from "@/lib/chart";

/**
 * The design canvas, as running code.
 *
 * It exists because a picture of a responsive layout proves nothing: the artboards were drawn
 * at 390, 834 and 1440, and this is where you find out whether the real thing does the same
 * three arrangements when a browser window is dragged across those widths. Resize it, count
 * the taps, and read the two graphs on an actual phone.
 *
 * Every figure below is invented. It is labelled that way on screen, and the route 404s
 * outside development, because a page of plausible pesos that anyone could reach is a page
 * somebody eventually screenshots as a report. The transactions table does not exist yet - the
 * phase 1 field-list gate blocks that migration - so there is nothing real to read instead.
 */

const BUSINESSES: BusinessLink[] = [
  { id: "laundry", type: "laundry", current: true },
  { id: "spa", type: "spa", current: false },
  { id: "skincare", type: "skincare", current: false },
];

const TILES: Tile[] = [
  { label: "Week to date", value: "₱48,900", note: "+12% vs last week", tone: "good" },
  { label: "Transactions", value: "41", note: "avg ₱304" },
  { label: "Staff in now", value: "5", note: "of 7" },
  { label: "Orders ready", value: "6", note: "2 over 3 days", tone: "warn" },
];

/** Oldest first; the last entry is today. Splits vary so the stacking is visibly doing work. */
const WEEK: ChartDay[] = [
  ["Thu", 2400, 1900, 1400],
  ["Fri", 3100, 2800, 1850],
  ["Sat", 2200, 1400, 1000],
  ["Sun", 3200, 3800, 2100],
  ["Mon", 2900, 2050, 1650],
  ["Tue", 3400, 2800, 2050],
  ["Wed", 5120, 4300, 3060],
].map(([label, laundry, spa, skincare]) => ({
  label: label as string,
  slices: [
    { type: "laundry", value: laundry as number },
    { type: "spa", value: spa as number },
    { type: "skincare", value: skincare as number },
  ],
}));

const ROWS: BusinessRow[] = [
  {
    type: "laundry",
    value: 5120,
    amount: "5,120.00",
    transactions: 18,
    variance: "0.00",
    closed: true,
  },
  {
    type: "spa",
    value: 4300,
    amount: "4,300.00",
    transactions: 12,
    variance: "-40.00",
    closed: true,
  },
  {
    type: "skincare",
    value: 3060,
    amount: "3,060.00",
    transactions: 11,
    variance: null,
    closed: false,
  },
];

const RECENT = [
  { time: "14:02", description: "Wash & fold, 4kg", amount: "180.00", method: "Cash" },
  { time: "13:47", description: "Dry clean, 2 pcs", amount: "420.00", method: "GCash" },
  { time: "13:30", description: "Wash & fold, 7kg", amount: "315.00", method: "Cash" },
  { time: "13:11", description: "Press only", amount: "90.00", method: "Cash" },
  { time: "12:58", description: "Wash & fold, 3kg", amount: "135.00", method: "Maya" },
];

function Recent() {
  return (
    <section className="rounded-xl bg-card p-4 shadow-card sm:px-[18px]">
      <header className="mb-1.5 flex items-baseline justify-between">
        <h2 className="text-[12.5px] text-muted-foreground">Today at this branch</h2>
        <Peso amount="1,140.00" className="text-[12.5px] text-muted-foreground" />
      </header>
      <ul>
        {RECENT.map((sale) => (
          <li
            key={sale.time}
            className="flex items-baseline justify-between border-t border-border py-2.5"
          >
            <div>
              <div className="text-[13.5px]">{sale.description}</div>
              <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground/70">
                {sale.time} · {sale.method}
              </div>
            </div>
            <Peso amount={sale.amount} className="text-[14.5px] font-semibold" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Banner() {
  return (
    <p className="border-b border-border bg-muted px-4 py-2 text-center text-xs text-muted-foreground sm:px-6">
      Design preview — every figure on this page is invented. Development only.
    </p>
  );
}

export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="flex flex-col">
      <section>
        <Banner />
        <AppShell
          orgName="Belas Group"
          roleLabel="Staff"
          userName="Ana Reyes"
          businesses={BUSINESSES}
          branchName="Main branch"
          destinations={[{ label: "Today", href: "/" }]}
          active="Counter"
        >
          <CounterScreen businessName="Laundry" branchName="Main branch" recent={<Recent />} />
        </AppShell>
      </section>

      <section className="border-t-8 border-border">
        <Banner />
        <AppShell
          orgName="Belas Group"
          roleLabel="Owner"
          userName="Matt Belas"
          businesses={BUSINESSES}
          branchName="All branches"
          destinations={[
            { label: "Today", href: "/" },
            { label: "Switch", href: "/switch" },
            { label: "Settings", href: "/settings" },
          ]}
          active="Dashboard"
        >
          <Dashboard
            heading="Wednesday, 31 August"
            total="12,480.00"
            subtitle="3 businesses · 4 branches · 41 transactions"
            tiles={TILES}
            week={WEEK}
            businesses={ROWS}
          />
        </AppShell>
      </section>
    </div>
  );
}
