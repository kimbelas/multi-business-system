import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { RoleChip } from "@/components/ui/chip";
import { Swatch } from "@/components/ui/swatch";
import { type BusinessType } from "@/lib/business";
import { type Role } from "@/lib/rbac";

/**
 * Which branch the app is pointed at, said out loud on the screen you land on.
 *
 * Card 0004's first criterion, and the failure mode it names is quiet: a sale entered against a
 * stale selected branch is attributed to the wrong place and nothing complains. The branch was
 * knowable before this existed - a `Current` chip somewhere down the branch list, and the shell's
 * top bar - but the top bar is `hidden sm:flex`, so on the platform the brief calls primary an
 * owner with four branches landed on a screen that never said which one they were on.
 *
 * So this is a statement rather than a control that happens to show a name. It carries the branch,
 * the business it belongs to and the role held *there* - `activeRole`, not the highest role held
 * anywhere, which is the distinction card 0004's third criterion was about.
 *
 * ## Why it is also the way to /switch
 *
 * Because the alternative is three places on one screen answering the same question. The branch
 * list already marks the current row and the page used to carry a separate "Switch branch" row at
 * the foot; naming the selection at the top and then offering the change somewhere else means the
 * answer and the correction are a scroll apart. Where there is nothing to switch to it renders as
 * a plain statement instead of a link, because a control that goes somewhere useless is worse than
 * no control.
 *
 * `Swatch` without `current`: the ring answers "which business am I in", and this whole row is
 * already that answer, so it would be marking the only thing on screen.
 */

const ROW =
  "flex min-h-pill items-center justify-between gap-3 rounded-xl bg-card px-3.5 py-2.5 shadow-card";

export function SelectedBranch({
  businessName,
  businessType,
  branchName,
  role,
  canSwitch,
  className,
}: {
  businessName: string;
  businessType: BusinessType;
  branchName: string;
  /** The role held at THIS branch. */
  role: Role;
  /** False when there is only one branch to be on, in which case this is not a link. */
  canSwitch: boolean;
  className?: string;
}) {
  const inner = (
    <>
      <span className="flex min-w-0 items-center gap-2.5">
        <Swatch type={businessType} />
        <span className="min-w-0">
          <span className="block truncate text-[14.5px] font-medium">{branchName}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {businessName}
          </span>
        </span>
      </span>
      <span className="flex flex-none items-center gap-1.5">
        <RoleChip role={role} />
        {canSwitch && (
          <>
            <span className="text-xs text-muted-foreground">Change</span>
            <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
          </>
        )}
      </span>
    </>
  );

  return (
    /*
     * A region with a name, so the assertion that this screen says which branch it is on can look
     * for the statement rather than for a string that might be anywhere on the page. The branch
     * name appears in the list below as well, and a test matching on the name alone would pass on
     * a page that had lost this entirely.
     */
    <section aria-label="Selected branch" className={className}>
      <p className="mb-1.5 px-1 text-[10.5px] tracking-[0.1em] text-muted-foreground/70 uppercase">
        Selected branch
      </p>
      {canSwitch ? (
        <Link
          href="/switch"
          className={`${ROW} transition-shadow hover:shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
        >
          {inner}
        </Link>
      ) : (
        <div className={ROW}>{inner}</div>
      )}
    </section>
  );
}
