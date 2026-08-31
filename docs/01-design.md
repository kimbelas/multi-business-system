# Design — Counter First

The chosen direction, picked from ten. Canvas:
<https://claude.ai/code/artifact/1936383a-efff-42ad-99aa-6f61517e613d> — the sale screen and
the owner dashboard drawn at 390, 834 and 1440, plus the rules below as an artboard. The ten
directions it was chosen from: <https://claude.ai/code/artifact/4ac1e7f5-0d12-4706-9d8a-1146a65e6f19>.

It is two halves of two directions. The **sale screen** is *Counter First*: a keypad, three
payment pills, one large committing button, and nothing else on screen. The **dashboard** is
*Owner First*: four stat tiles, a week trend with today filled in, the three businesses, and
the un-closed branch called out in red.

Where the two disagreed — page background, card border, radius — Counter First's values win,
because the counter is the screen staff look at all day and the dashboard is the screen the
owner glances at.

Eight directions were rejected. Two of them are worth remembering: *Big Button Utility*
proved the four-tap rule does not require shouting, and *Owner First*'s own sale screen — a
four-field form — is what this direction refuses. It was drawn deliberately so the tradeoff
was on the table rather than assumed away.

## The six responsive rules

The brief says **mobile-first, always**. That is not the same as mobile-only, and the failure
mode of mobile-first is a phone layout stretched across a desktop. These six are what "good
on tablet and desktop" means here.

1. **The keypad is capped, never stretched.** 380–420px at every width (`--pad-max`). Extra
   room becomes context, not bigger keys — a 700px numpad is *slower* than a 380px one,
   because the thumb travels further between digits. This is the rule the whole responsive
   design turns on, and it is the one guarded by a test.

2. **The sale screen gains context; the dashboard gains columns.** Widening the counter puts
   today's sales beside the pad and never rearranges the pad itself. Widening the dashboard
   turns 2×2 tiles into 4×1 and the business list into a table with variance and close status.
   Different screens, different answers to the same extra width.

3. **Commit sits directly under the keypad at every width.** Never promoted to a top toolbar
   on desktop, never moved into a sticky footer. The same person uses the phone at intake and
   the front-desk laptop at close, so the same muscle memory has to work on both.

4. **Nothing shrinks on a bigger screen.** Keys ≥58px, method pills ≥46px, commit ≥60px, no
   type under 11.5px. The front-desk machine may well have a touchscreen, so desktop is a
   touch target too — and the four-tap rule does not get easier because the screen got bigger.

5. **Desktop adds a keyboard path, not a second layout.** Digits type, Enter records, Esc
   clears. That is the only desktop-only affordance in the design; the layout is the same one
   with more columns.

6. **The rail is a rail only at ≥1024px.** Below that the business and branch switcher lives
   in the top bar; below 640px the top bar collapses into the one line above the amount. Two
   breakpoints, three arrangements, no fourth layout to maintain.

## Breakpoints

Two, both Tailwind defaults. Adding a third is adding a layout somebody has to keep working.

| | Width | Arrangement |
|---|---|---|
| base | < 640 | One column. Branch on one line, keypad full width, commit at the bottom. |
| `sm` | ≥ 640 | Top bar appears with the branch switcher. Composer and keypad side by side. |
| `lg` | ≥ 1024 | Left rail appears. Recent sales become a third column; tiles go 4 across. |

## Colour

The base is shadcn `base-nova` with the `neutral` scale, which is chroma 0 throughout — a
deliberately colourless theme. Everything below is what was added to it, and it lives in an
appended block at the foot of `src/app/globals.css` rather than merged into the generated one,
because `shadcn init` and some `shadcn add` runs rewrite that block.

| Token | Value | Job |
|---|---|---|
| `--background` | `#fafafa` | The page ground. shadcn ships this pure white, which leaves a 1px border doing all the work of separating page from card. |
| `--card` | `#ffffff` | The raised surface. 14px radius. |
| `--commit` | `#0d9488` | **Two places, both enumerable:** the Record sale button, and the dot marking which business you are looking at. Nowhere else — not a link, not a focus ring, not a chart series. |
| `--commit-deep` | `#042f2e` | The chosen payment pill. The accent hue at 28% lightness: dark enough to read as ink, related enough that the pad and the commit button look like one control group. Its only other appearance. |
| `--good` / `--warn` | `#16a34a` / `#ca8a04` | Direction on a number, in tile subtitles. Never a surface, never a fill. |
| `--destructive-surface` / `-border` / `-strong` | `#fef2f2` / `#fecaca` / `#991b1b` | shadcn has one destructive colour; the un-closed-branch card needs three. |

**No indigo, violet or purple.** That is the hue family every generated interface reaches for,
and the theme shipped with exactly one chromatic value in it — a violet `--sidebar-primary`
that no one chose. It is corrected in the generated block rather than shadowed by a later
override, because a wrong value left in the file is a wrong value somebody greps for and
believes.

## Sizing

| | Value | |
|---|---|---|
| Numpad key | 62px mobile and tablet, 58px desktop | 12px radius |
| Method pill | 46px | 999px radius |
| Record sale | 60px | 14px radius, accent fill |
| Card radius | 14px | 16px on the desktop composer shell |
| Type floor | 11.5px | timestamps and tile subtitles only |
| Body | 13.5–15px | labels 12–12.5px |
| Figures | mono, 17–52px | 600 weight, `-.02em` at display sizes |

The floors are exposed as Tailwind utilities — `h-key`, `h-pill`, `h-commit`, `max-w-pad` —
so a violation shows up in the markup instead of being a number somebody was supposed to
remember.

## What is enforced, and where

A design rule that lives only in prose drifts. These are the layers:

- **`tests/design-tokens.test.ts`** — no oklch hue in 240–300 above 0.05 chroma; the accent
  stays in the teal family; every added token is defined for both light and dark; the three
  control floors hold; the keypad cap stays between 360 and 440px. Verified by reintroducing
  the violet and watching it fail.
- **The utilities above** — a control shorter than its floor has to be written as a raw
  number to get there.
- **This file** — everything a test cannot express, which is most of the six rules.

**A change to the design changes its guardrail in the same commit.** The alternative is what
already happened once here: a palette that had moved on while the value naming it stayed
behind.

## Deliberately not decided

- **Dark mode is defined but not drawn.** Every token has a dark value so the app does not
  break in it, but no artboard was drawn dark and nothing has been checked. *Dark Counter* was
  one of the ten and was not chosen; if dark becomes real it is a design pass, not a token flip.
- **No variance colour bands.** Settled already: the dashboard shows the figure and its sign
  with no colour at all until the bands are set from two weeks of real closes. The red on the
  dashboard is for a branch that did not close, which is a fact rather than a threshold.
- **The chart is bars, and that is the only chart.** Seven bars, today filled. No second chart
  type ships without a reason that names what question it answers.
