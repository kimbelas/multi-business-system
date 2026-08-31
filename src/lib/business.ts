/**
 * One registry for everything the UI needs to know about a business type.
 *
 * The spec's promise is that a fourth business is "one extension table and one feature folder,
 * zero core changes". This is the presentation half of that promise: adding a type is one entry
 * here plus one colour in the theme, and nothing else in the app has a list of three of
 * anything. `BusinessType` is derived from these keys rather than declared separately, so the
 * two can never drift apart.
 *
 * What it must stay in step with is the database. `business_type` is a Postgres enum, and a
 * registry that disagrees with it is a runtime `undefined` on a dashboard - so
 * `tests/business.test.ts` reads the migration and fails if the two sets differ.
 */

export interface BusinessMeta {
  /** What a person is shown. Never derive this from the key. */
  readonly label: string;
  /** The theme token holding this business's colour. See `businessColor`. */
  readonly token: `--biz-${string}`;
  /**
   * Which of shadcn's `--chart-N` slots aliases this colour, for any component that expects
   * that contract. Deliberately not the position in this object: reordering these keys is a
   * presentation change, and deriving the slot from the index would silently recolour every
   * chart in the app.
   */
  readonly chartSlot: number;
}

export const BUSINESS = {
  laundry: { label: "Laundry", token: "--biz-laundry", chartSlot: 1 },
  spa: { label: "Spa", token: "--biz-spa", chartSlot: 2 },
  skincare: { label: "Skin Care", token: "--biz-skincare", chartSlot: 3 },
} as const satisfies Record<string, BusinessMeta>;

export type BusinessType = keyof typeof BUSINESS;

/** Presentation order. Changing it reorders lists and legends and recolours nothing. */
export const BUSINESS_TYPES = Object.keys(BUSINESS) as BusinessType[];

export function businessLabel(type: BusinessType): string {
  return BUSINESS[type].label;
}

/**
 * A business's colour, as a custom property reference.
 *
 * Not a Tailwind class. `bg-biz-${type}` is not in the source as a literal, so Tailwind
 * generates no utility for it and the element renders with no background at all - silently,
 * which is the worst way for a colour to be wrong. An inline style referencing the token still
 * resolves through the theme and still flips in dark mode.
 *
 * Where the type is known at author time, `bg-biz-spa` is the better spelling and exists.
 */
export function businessColor(type: BusinessType): string {
  return `var(${BUSINESS[type].token})`;
}

/** Anything the app cannot attribute to a business. Grey, because it is an absence. */
export const UNATTRIBUTED_COLOR = "var(--biz-none)";
