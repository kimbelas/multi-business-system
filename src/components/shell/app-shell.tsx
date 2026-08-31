import { ChevronDown } from "lucide-react";

import { BUSINESS_LABEL, type BusinessType, businessColor } from "@/lib/business";
import { cn } from "@/lib/utils";

/**
 * The chrome around every screen, and the whole of rule 6.
 *
 * The rail is a rail only at lg. Below that the business and branch switcher lives in the top
 * bar, and below sm the top bar goes too - the screen says which branch it is on in one line
 * above the amount, which is the only thing a phone has room for. Two breakpoints, three
 * arrangements, and no fourth layout to keep working.
 *
 * The business dots carry the chart scale rather than the accent, so the colour that
 * identifies a business is the same colour in the rail, in a bar segment and in a table row.
 * The accent ring is what marks which one you are in - a different question from which one
 * this is.
 */

export interface BusinessLink {
  readonly id: string;
  readonly type: BusinessType;
  readonly current: boolean;
}

const NAV = ["Counter", "Dashboard", "Orders", "Clients", "Staff", "Reports", "Settings"] as const;
export type NavItem = (typeof NAV)[number];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function BusinessDots({ businesses }: { businesses: readonly BusinessLink[] }) {
  return (
    <ul className="flex flex-col">
      {businesses.map((business) => (
        <li
          key={business.id}
          className={cn(
            "flex h-[34px] items-center gap-3.5 text-[13.5px]",
            business.current ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-2.5 flex-none rounded-[3px]",
              // The ring is the accent and the offset is the card, in that order: the offset
              // sits *inside* the ring, so swapping them draws a white ring on a white card
              // and the current business ends up with no marker at all.
              business.current && "ring-2 ring-commit ring-offset-2 ring-offset-card",
            )}
            style={{ backgroundColor: businessColor(business.type) }}
          />
          {BUSINESS_LABEL[business.type]}
          {business.current ? <span className="sr-only">(current)</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function AppShell({
  orgName,
  roleLabel,
  userName,
  businesses,
  branchName,
  active,
  children,
}: {
  orgName: string;
  roleLabel: string;
  userName: string;
  businesses: readonly BusinessLink[];
  branchName: string;
  active: NavItem;
  children: React.ReactNode;
}) {
  const current = businesses.find((b) => b.current);
  const currentLabel = current ? BUSINESS_LABEL[current.type] : orgName;

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <nav
        aria-label="Main"
        className="hidden w-[220px] flex-none flex-col gap-5 border-r border-border bg-card p-[22px_16px] lg:flex"
      >
        <div>
          <div className="text-[15.5px] font-semibold">{orgName}</div>
          <div className="mt-px text-xs text-muted-foreground/70">{roleLabel}</div>
        </div>

        <div>
          <div className="mb-1.5 text-[10.5px] tracking-[0.1em] text-muted-foreground/70 uppercase">
            Businesses
          </div>
          <BusinessDots businesses={businesses} />
        </div>

        <ul className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <li key={item}>
              <span
                aria-current={item === active ? "page" : undefined}
                className={cn(
                  "flex h-[38px] items-center rounded-[9px] px-3 text-sm",
                  item === active
                    ? "bg-muted font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {item}
              </span>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-1 flex-col">
        {/* sm and up. On a phone the screen names its own branch in one line instead. */}
        <header className="hidden h-[60px] flex-none items-center justify-between border-b border-border bg-card px-6 sm:flex">
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-semibold">{active === "Counter" ? currentLabel : active}</span>
            <span className="text-muted-foreground/70">/</span>
            <span className="text-[14.5px] text-muted-foreground">{branchName}</span>
            <ChevronDown aria-hidden className="size-3.5 text-muted-foreground/70" />
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-[13.5px] text-muted-foreground">{userName}</span>
            <span
              aria-hidden
              className="flex size-[30px] items-center justify-center rounded-full bg-commit-deep text-xs font-semibold text-white"
            >
              {initials(userName)}
            </span>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
