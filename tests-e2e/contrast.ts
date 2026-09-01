import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The measured contrast of an element's own text against whatever actually paints behind it.
 *
 * Extracted rather than copied. The first version of this lived inline in one spec, and a second
 * dialog needing the same assertion is exactly the moment sixty lines of arithmetic gets
 * duplicated - at which point a fix to one copy leaves the other measuring nonsense, which is
 * precisely the failure this code already had once.
 *
 * ## Why the browser does the parsing
 *
 * The version that shipped read `getComputedStyle().color`, pulled the first three numbers out with
 * a regex and treated them as 0-255 sRGB. Chrome serialises a colour authored in `oklch()` as
 * `oklch(0.971 0.013 17.38)`, so every channel came out below 1, both luminances collapsed to about
 * zero, and both themes reported a ratio near 1.0 - light mode "failed" at 1.09 where the real
 * figure is 7.64:1. It surfaced only because the number was absurd; above 4.5 it would have passed
 * forever while measuring nothing.
 *
 * So a 1x1 canvas normalises any colour syntax to sRGB bytes, a sentinel catches a value the browser
 * will not parse instead of silently keeping the previous fill, the background is resolved by walking
 * up until something paints opaque - treating transparent as black is how a bogus ratio is
 * manufactured - and the whole thing self-checks that white on black measures 21.
 */
export async function contrastOf(element: Locator): Promise<number> {
  return element.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;

    /** Any CSS colour syntax in, sRGB bytes out: oklab, oklch, rgb, hex or a keyword. */
    const bytes = (value: string): number[] => {
      const sentinel = "#123456";
      ctx.fillStyle = sentinel;
      ctx.fillStyle = value;
      if (ctx.fillStyle === sentinel && value !== sentinel) {
        throw new Error(`the browser would not parse ${value} as a colour`);
      }
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };

    const lum = ([r, g, b]: number[]) => {
      const [lr, lg, lb] = [r, g, b].map((c) => {
        const channel = c / 255;
        return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };

    const contrast = (one: number, two: number) => {
      const [hi, lo] = [one, two].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    /*
     * A self-check, because the failure this replaces was a measurement that returned a
     * plausible-looking number instead of an error. If the arithmetic is right this is 21.
     */
    const known = contrast(lum(bytes("#ffffff")), lum(bytes("#000000")));
    if (Math.abs(known - 21) > 0.01) {
      throw new Error(`the contrast maths is broken: white on black measured ${known}`);
    }

    /*
     * The element's own background may be transparent, and treating that as black is exactly how a
     * bogus ratio gets manufactured. Walk up until something actually paints.
     */
    let node: Element | null = el;
    let background: number[] | null = null;
    while (node) {
      const painted = bytes(getComputedStyle(node).backgroundColor);
      if (painted[3] === 255) {
        background = painted;
        break;
      }
      node = node.parentElement;
    }
    if (!background) throw new Error("nothing above this element paints an opaque background");

    return contrast(lum(bytes(getComputedStyle(el).color)), lum(background));
  });
}

/**
 * Put the page in one theme and assert it took.
 *
 * The assertion is the point: without it the dark case quietly measures the light one, and the more
 * dangerous of a pair of inverting tokens never gets looked at. `layout.tsx` adds `.dark` from
 * `localStorage` in an inline script, so this is set-then-reload rather than a class toggle.
 */
export async function useTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate(
    (value) => {
      if (value) localStorage.setItem("theme", value);
      else localStorage.removeItem("theme");
    },
    theme === "dark" ? "dark" : null,
  );
  await page.reload();

  expect(
    await page.evaluate(() => document.documentElement.classList.contains("dark")),
    `the ${theme} theme should be applied to the document`,
  ).toBe(theme === "dark");
}
