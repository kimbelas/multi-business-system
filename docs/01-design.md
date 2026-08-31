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

## The seven responsive rules

The brief says **mobile-first, always**. That is not the same as mobile-only, and the failure
mode of mobile-first is a phone layout stretched across a desktop. These seven are what "good
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

7. **Colour identifies a business and nothing else.** A hue means the same business wherever
   you meet it — a bar segment, the share bar, a table row, the rail dot. Past days in the week
   chart are the same hues dimmed rather than a fourth colour, because the week is context and
   today is the subject. Nothing else on screen carries a hue except the accent on Record sale
   and the red on a branch that did not close.

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
| `--commit` | `#0d9488` | **Two places, both enumerable:** the Record sale button, and the ring around the rail dot for the business you are currently in. The dot itself is that business's chart hue — the accent answers "which one am I in", the hue answers "which one is this". Nowhere else: not a link, not a chart series, not the focus ring. |
| `--commit-deep` | `#042f2e` | The chosen payment pill. The accent hue at 28% lightness: dark enough to read as ink, related enough that the pad and the commit button look like one control group. Its only other appearance. |
| `--good` / `--warn` | `#16a34a` / `#ca8a04` | Direction on a number, in tile subtitles. Never a surface, never a fill. |
| `--destructive-surface` / `-border` / `-strong` | `#fef2f2` / `#fecaca` / `#991b1b` | shadcn has one destructive colour; the un-closed-branch card needs three. |

**No indigo, violet or purple.** That is the hue family every generated interface reaches for,
and the theme shipped with exactly one chromatic value in it — a violet `--sidebar-primary`
that no one chose. It is corrected in the generated block rather than shadowed by a later
override, because a wrong value left in the file is a wrong value somebody greps for and
believes.

## Chart colour

A single-series bar chart has nothing for colour to say, so the week chart is **stacked by
business** and the hue is the only thing telling you which slice is which. It carries the
information rather than brightening the page, which is the whole reason colour is allowed here.

Three hues at roughly the widest separation available. The accent (184) is spoken for, the two
direction colours sit at 149 and 76, and the banned indigo-violet band 240–300 rules out every
real blue in the palette — Tailwind `blue-600` is hue 263 — so cyan takes that job.

| `--chart-` | Business | Value | |
|---|---|---|---|
| 1 | Laundry | `#0891b2` | cyan, hue 222 |
| 2 | Spa | `#ec4899` | pink, hue 354 |
| 3 | Skin Care | `#d97706` | amber, hue 58 |
| 4 | *reserved* | `#65a30d` | lime, hue 132 — a fourth business type |
| 5 | Unattributed | `#737373` | no hue, because it is an absence rather than a thing |

`src/lib/business.ts` owns the type-to-hue mapping, and it is the only one. The colour comes
back as a `var(--chart-N)` string rather than a Tailwind class, because `bg-chart-${n}` is not
in the source as a literal — Tailwind generates no utility for it and the element renders
unstyled, silently.

The slot numbers are deliberately **not** derived from the position in `BUSINESS_TYPES`:
reordering that array is a presentation change, and it would otherwise recolour every chart in
the app.

There is no chart library. The Worker is capped at 3 MiB compressed and a stacked bar is
flexbox.

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
  control floors hold; the keypad cap stays between 360 and 440px; and no variable refers to
  itself. Verified by reintroducing the violet and watching it fail.
- **`tests-e2e/counter.spec.ts`** — the rules that are only true in a browser, measured at 390,
  834 and 1440: four taps records a sale, a zero sale is refused, every control clears its
  floor, the pad stays capped, commit stays under the pad, nothing scrolls sideways, the rail
  appears only from 1024, the table only from 640, the week chart resolves three distinct
  colours, and the share percentages add to 100.
- **`tests/chart.test.ts`** — the share percentages sum to exactly 100 across 200 random
  splits. Rounding each share independently gives 99 on the real numbers, and the bar would
  have a visible gap in it.
- **The utilities above** — a control shorter than its floor has to be written as a raw
  number to get there.
- **This file** — everything a test cannot express, which is most of the seven rules.

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
- **Two graphs, both bars.** The week chart, stacked by business, and one horizontal share bar
  for today. No third graph and no other chart type ships without a reason that names the
  question it answers — a line chart of a seven-point series answers nothing a bar does not.

## Seeing it

`/preview` renders both screens with invented figures, labelled as such on the page. It 404s
outside development and the middleware only lets it through when `NODE_ENV` is not
`production` — two guards, neither redundant: the route guard stops it rendering on a deployed
site, the middleware guard stops the auth redirect making it unreachable locally.

It exists because a picture of a responsive layout proves nothing. Drag the window across 640
and 1024 and watch the three arrangements happen.

Finding it also turned up a bug that had nothing to do with design and everything to do with
trusting tests: `next dev` was returning 403 for every `/_next/static/chunks/*.js`, because
Next 16 blocks cross-origin dev resources and counts `127.0.0.1` as a different host from
`localhost` — which is the address `playwright.config.ts` points the whole suite at. Every page
rendered and none of them hydrated, and `smoke.spec.ts` passed the entire time, because a
status code and a visible body are both true of a page with no JavaScript running.
`allowedDevOrigins` in `next.config.ts` is the fix; the counter spec is what would have caught
it.
