import { type BusinessType, businessColor } from "@/lib/business";
import { cn } from "@/lib/utils";

/**
 * The little coloured square that says which business something belongs to.
 *
 * It appears in the chart legend, the share bar, the by-business table and the rail, and it was
 * five copies of the same six lines before this existed. One of those copies had the ring and
 * its offset the wrong way round, which is precisely the bug a repeated fragment invites.
 *
 * `current` draws the accent ring: the square answers "which business is this", the ring
 * answers "which one am I in". Two different questions, so two different colours.
 */
export function Swatch({
  type,
  current = false,
  className,
}: {
  type: BusinessType;
  current?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 flex-none rounded-[3px]",
        // The ring is the accent and the offset is the card, in that order. The offset sits
        // inside the ring, so swapping them draws a white ring on a white card and marks
        // nothing at all.
        current && "ring-2 ring-commit ring-offset-2 ring-offset-card",
        className,
      )}
      style={{ backgroundColor: businessColor(type) }}
    />
  );
}
