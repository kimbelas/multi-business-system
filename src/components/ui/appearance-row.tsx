import { ThemeToggle } from "@/components/ui/theme-toggle";

/**
 * The theme control for the widths that have no chrome to hang one on.
 *
 * `AppShell` puts a `ThemeToggle` in the rail (from 1024) and in the header (from 640). Below 640
 * there is neither, and the design doc used to justify that gap by saying the inline script follows
 * the operating system — "which is the setting a phone user has actually made".
 *
 * That justification went away when light became the default and the OS stopped being consulted.
 * Without something like this, a phone would be light with no way out, on the one platform the
 * brief calls primary: the owner is on a phone, and so is every staff member entering a sale.
 *
 * `sm:hidden`, so it appears only where the header does not. Two controls for the same setting on
 * one screen is worse than one in an odd place.
 */
export function AppearanceRow({ className }: { className?: string }) {
  return (
    <div
      className={[
        "flex items-center justify-between gap-4 rounded-xl border border-border p-4 sm:hidden",
        className ?? "",
      ]
        .join(" ")
        .trim()}
    >
      <div>
        <p className="text-sm font-medium">Appearance</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Light unless you choose otherwise. Remembered on this device.
        </p>
      </div>
      {/* `h-pill w-pill` is the 46px floor, which is also a comfortable thumb target - the
       * header's 36px icon button is fine for a mouse and mean for a thumb.
       *
       * Spelled the way the rest of the app spells it. `size-pill` would compile from the same
       * `--spacing-pill`, but every other control here uses `h-pill` / `h-key` / `h-commit`, and
       * those are the names `tests/design-tokens.test.ts` asserts exist. A utility that silently
       * resolves to nothing is how every heading in this app once rendered in Times. */}
      <ThemeToggle className="flex h-pill w-pill flex-none items-center justify-center rounded-full border border-border text-muted-foreground" />
    </div>
  );
}
