import { type Role, roleLabel } from "@/lib/rbac";

/**
 * A small status word beside something.
 *
 * Three tones and no more. The palette's job here is to say "this one is different", not to
 * colour-code a taxonomy: `--commit` is already spoken for as the accent that marks the current
 * thing, and the business hues belong to businesses. So a chip is neutral unless it is saying
 * *current*, and `muted` is for a fact that is true and unimportant - an inactive branch is still
 * a branch.
 *
 * No hue is introduced. Everything below is an existing token.
 */
type Tone = "neutral" | "current" | "muted";

/*
 * The accent marks `current` on the **border**, not on the text, and that is a measured decision
 * rather than a stylistic one.
 *
 * `--commit` as 11.5px text was the first version. Measured against the WCAG ratio:
 *
 *   light  #148b92 on card    #ffffff   4.09:1   fails small text (4.5), clears graphical (3.0)
 *   light  #148b92 on ground  #fafafa   3.92:1   fails small text,       clears graphical
 *   dark   #60bfc6 on card    ~#333333  5.88:1   passes both
 *
 * So it would have been legible in dark and not in light - the mode that is now the default - and
 * it would have looked deliberate in both. As a border it is a graphical object, which is the
 * threshold it clears, and the label keeps `--foreground` at 15.33:1. Full strength rather than
 * `/40`, because opacity would drop the border under 3:1 as well.
 *
 * `muted` is a dashed border rather than fainter text. `text-muted-foreground` is already about
 * 3.1:1 on white and is used for body copy throughout the app, which is the design's existing
 * baseline and not mine to change here - but going *below* it with `/70` would have been.
 */
const TONE: Record<Tone, string> = {
  neutral: "border-border text-muted-foreground",
  current: "border-commit text-foreground",
  muted: "border-dashed border-border text-muted-foreground",
};

export function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex flex-none items-center rounded-full border px-2 py-0.5 text-[11.5px] leading-none whitespace-nowrap ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The role someone holds somewhere.
 *
 * A component rather than a `<Chip>{roleLabel(role)}</Chip>` at each call site, because the role
 * appears on three screens and "which tone does a role get" is the kind of decision that drifts
 * into two answers if it is written down twice.
 *
 * 11.5px is the type floor from the design doc, and it applies here for the reason the floor
 * exists: this is a label beside a name, not something anybody reads a paragraph of.
 */
export function RoleChip({ role }: { role: Role }) {
  return <Chip>{roleLabel(role)}</Chip>;
}
