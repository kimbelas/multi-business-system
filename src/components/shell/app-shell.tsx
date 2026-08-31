import { ChevronDown } from "lucide-react";

import { Swatch } from "@/components/ui/swatch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { type BusinessType, businessLabel } from "@/lib/business";
import { cn } from "@/lib/utils";

/**
 * The chrome around every screen, and the whole of rule 6.
 *
 * The rail is a rail only at lg. Below that the business and branch switcher lives in the top
 * bar, and below sm the top bar goes too - the screen names its own branch in one line above
 * the amount, which is all a phone has room for. Two breakpoints, three arrangements, and no
 * fourth layout to keep working.
 *
 * The business squares carry each business's own colour rather than the accent, so the colour
 * that identifies a business is the same colour in the rail, in a bar segment and in a table
 * row. The accent ring marks which one you are in - a different question from which one it is.
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
  const current = businesses.find((business) => business.current);
  const currentLabel = current ? businessLabel(current.type) : orgName;

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <nav
        aria-label="Main"
        className="hidden w-[220px] flex-none flex-col gap-5 border-r border-border bg-card px-4 py-[22px] lg:flex"
      >
        <div>
          <div className="text-[15.5px] font-semibold">{orgName}</div>
          <div className="mt-px text-xs text-muted-foreground/70">{roleLabel}</div>
        </div>

        <div>
          <div className="mb-1.5 text-[10.5px] tracking-[0.1em] text-muted-foreground/70 uppercase">
            Businesses
          </div>
          <ul className="flex flex-col">
            {businesses.map((business) => (
              <li
                key={business.id}
                className={cn(
                  "flex h-[34px] items-center gap-3.5 text-[13.5px]",
                  business.current ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                <Swatch type={business.type} current={business.current} />
                {businessLabel(business.type)}
                {business.current ? <span className="sr-only">(current)</span> : null}
              </li>
            ))}
          </ul>
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

        <ThemeToggle className="mt-auto flex h-9 w-9 items-center justify-center rounded-[9px] text-muted-foreground hover:bg-muted" />
      </nav>

      <div className="flex flex-1 flex-col">
        {/* sm and up. On a phone the screen names its own branch instead - and there is no
            theme control below sm either, deliberately. The phone layout has no chrome to hang
            one on, and the inline script in layout.tsx already follows the operating system,
            which is the setting a phone user has actually made. A manual override belongs on
            the Settings screen when that exists, not on the four-tap screen. */}
        <header className="hidden h-[60px] flex-none items-center justify-between border-b border-border bg-card px-6 sm:flex">
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-semibold">
              {active === "Counter" ? currentLabel : active}
            </span>
            <span className="text-muted-foreground/70">/</span>
            <span className="text-[14.5px] text-muted-foreground">{branchName}</span>
            <ChevronDown aria-hidden className="size-3.5 text-muted-foreground/70" />
          </div>
          <div className="flex items-center gap-2.5">
            {/* Only where the rail is absent, so the control appears exactly once. */}
            <ThemeToggle className="flex h-9 w-9 items-center justify-center rounded-[9px] text-muted-foreground hover:bg-muted lg:hidden" />
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
