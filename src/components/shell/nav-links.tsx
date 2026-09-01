"use client";

import { ArrowLeftRight, House, Settings, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * The navigation, as links that go somewhere.
 *
 * The rail used to render `navFor(role)` as inert `<span>`s — Counter, Orders, Clients, Staff,
 * Reports — none of which are built. Seven labels, no destinations. `app-shell.tsx` said as much
 * in a comment ("labels rather than links and there is nothing to be on"), which made it a known
 * placeholder rather than an accident, and it is still the thing `lib/rbac.ts` says this whole
 * layer exists to avoid: a screen should not offer a door that opens onto nothing.
 *
 * So this renders only destinations that exist. It is a client component for one reason — the
 * active item comes from `usePathname` rather than from a prop each page has to remember to
 * pass, which is what the same comment predicted it would become.
 */

export interface Destination {
  label: string;
  href: string;
}

/** Lucide, already a dependency and already the app's icon set. */
const ICONS: Record<string, LucideIcon> = {
  Today: House,
  Switch: ArrowLeftRight,
  Settings: Settings,
};

/**
 * `/` matches only exactly; everything else matches its subtree.
 *
 * Without the exact case every route is "under" `/` and Today is permanently active, which is the
 * standard version of this bug.
 */
function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({
  destinations,
  variant,
}: {
  destinations: readonly Destination[];
  variant: "rail" | "bar";
}) {
  const pathname = usePathname();

  if (variant === "bar") {
    return (
      <nav
        aria-label="Main"
        /*
         * Sticky rather than fixed, and inside the content column: a fixed bar sits on top of the
         * page and covers the last row of whatever is scrolled to the bottom. The translucency is
         * the one thing borrowed from the glass direction, and it is why the bar needs a blur —
         * without it, text scrolling underneath shows through and the labels lose their contrast.
         */
        className="sticky bottom-0 z-10 flex flex-none gap-1 border-t border-border/60 bg-card/85 px-2 pt-2 pb-2.5 backdrop-blur-md lg:hidden"
      >
        {destinations.map(({ label, href }) => {
          const Icon = ICONS[label] ?? House;
          const on = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-pill flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5",
                on ? "bg-commit/10 text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon
                aria-hidden
                className={cn("size-5", on && "text-commit")}
                strokeWidth={on ? 2.2 : 1.8}
              />
              <span className="text-[11.5px] leading-none">{label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {destinations.map(({ label, href }) => {
        const Icon = ICONS[label] ?? House;
        const on = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex h-[38px] items-center gap-3 rounded-[9px] px-3 text-sm",
                on
                  ? "bg-commit/10 font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon aria-hidden className={cn("size-4", on && "text-commit")} strokeWidth={1.8} />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
