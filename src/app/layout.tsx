import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bizdesk",
  description: "Sales, orders and attendance across three businesses.",
};

/**
 * Applies the stored theme before the first paint.
 *
 * This has to be a blocking inline script and there is no way around it. Doing the same work in
 * an effect means the server-rendered light theme is painted first and then replaced, which is
 * the white flash every dark-mode site with a React theme switcher has. The script is a string
 * literal in this file - no interpolation, nothing from a request - so there is nothing here for
 * anyone to inject into.
 *
 * `null` falls back to the operating system rather than to light, so a phone in dark mode gets
 * dark on the first visit without anybody choosing.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="dark"||(t===null&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}`;

/*
 * Typed by hand, not with Next's generated `LayoutProps<"/">`.
 *
 * That type is emitted into `.next/types/` by a build. It resolves on a machine that has run
 * `next dev` and does not exist in a fresh checkout, so `pnpm typecheck` passed locally and
 * failed in CI with `TS2304: Cannot find name 'LayoutProps'` - on every push since the
 * scaffold. Twelve red runs, and because deploy.yml only fires on a green CI, twelve skipped
 * deploys. The generated types are convenient and they are not part of the program.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * `suppressHydrationWarning` because the script above adds a class the server did not
     * render. It suppresses the warning for this element's attributes only, not for the tree,
     * so a real mismatch inside the app still reports.
     */
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
