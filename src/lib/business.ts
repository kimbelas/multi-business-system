/**
 * The three business types, and the one place a type becomes a colour.
 *
 * A hue means the same business wherever you meet it - a bar segment, the share bar, a table
 * row, the rail. That only stays true if there is exactly one mapping, so this is it.
 *
 * The colour comes back as a `var(--chart-N)` string rather than a Tailwind class because a
 * class built at runtime is a class Tailwind never sees: `bg-chart-${n}` is not in the source
 * as a literal, so no utility is generated for it and the element renders unstyled. An inline
 * `style` referencing the custom property is the honest version - it still resolves through
 * the theme, still flips in dark mode, and cannot be tree-shaken away.
 */

export const BUSINESS_TYPES = ["laundry", "spa", "skincare"] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_LABEL: Record<BusinessType, string> = {
  laundry: "Laundry",
  spa: "Spa",
  skincare: "Skin Care",
};

/**
 * Which slot of the chart scale each type owns. Deliberately not derived from the array
 * index: reordering `BUSINESS_TYPES` would then silently recolour every chart in the app,
 * and the order of that array is about presentation while these numbers are identity.
 */
const CHART_SLOT: Record<BusinessType, 1 | 2 | 3> = {
  laundry: 1, // cyan
  spa: 2, // pink
  skincare: 3, // amber
};

export function businessColor(type: BusinessType): string {
  return `var(--chart-${CHART_SLOT[type]})`;
}

/** Anything the app cannot attribute to a business. Grey, because it is an absence. */
export const UNATTRIBUTED_COLOR = "var(--chart-5)";
