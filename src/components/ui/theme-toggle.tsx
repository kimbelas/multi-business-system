"use client";

import { Moon, Sun } from "lucide-react";

/**
 * Light and dark, switched and remembered.
 *
 * Deliberately holds no React state. The obvious version keeps the current theme in `useState`
 * and renders the matching icon, which mismatches on hydration every single time: the server
 * has no idea what the browser chose, so it renders the wrong icon and React replaces it. The
 * two icons are both in the markup and CSS picks - `dark:hidden` and `hidden dark:block` - so
 * the server output is correct whichever theme the page opens in.
 *
 * The class is applied before first paint by the inline script in `layout.tsx`; this only
 * flips it afterwards. Splitting it that way is what stops the light theme flashing on a
 * dark-mode reload.
 */
export function ThemeToggle({ className }: { className?: string }) {
  function toggle() {
    const root = document.documentElement;
    const dark = root.classList.toggle("dark");
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // Private mode, or storage disabled. The theme still switches for this page; it just
      // will not be remembered, which is better than not switching at all.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark"
      className={className}
    >
      <Sun aria-hidden className="size-4 dark:hidden" />
      <Moon aria-hidden className="hidden size-4 dark:block" />
    </button>
  );
}
