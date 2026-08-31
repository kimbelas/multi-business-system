# Design — Counter First

The chosen direction, picked from ten. Canvas:
<https://claude.ai/code/artifact/1936383a-efff-42ad-99aa-6f61517e613d> — the sale screen and
the owner dashboard drawn at 390, 834 and 1440, plus the rules below as an artboard. The ten
directions it was chosen from: <https://claude.ai/code/artifact/4ac1e7f5-0d12-4706-9d8a-1146a65e6f19>.

It is two halves of two directions. The **sale screen** is _Counter First_: a keypad, three
payment pills, one large committing button, and nothing else on screen. The **dashboard** is
_Owner First_: four stat tiles, a week trend with today filled in, the three businesses, and
the un-closed branch called out in red.

Where the two disagreed — page background, card border, radius — Counter First's values win,
because the counter is the screen staff look at all day and the dashboard is the screen the
owner glances at.

Eight directions were rejected. Two of them are worth remembering: _Big Button Utility_
proved the four-tap rule does not require shouting, and _Owner First_'s own sale screen — a
four-field form — is what this direction refuses. It was drawn deliberately so the tradeoff
was on the table rather than assumed away.

## The eight rules

The brief says **mobile-first, always**. That is not the same as mobile-only, and the failure
mode of mobile-first is a phone layout stretched across a desktop. The first six are what "good
on tablet and desktop" means here.

1. **The keypad is capped, never stretched.** 380–420px at every width (`--pad-max`). Extra
   room becomes context, not bigger keys — a 700px numpad is _slower_ than a 380px one,
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
   you meet it — a bar segment, the share bar, a table row, the rail square. Past days in the
   week chart are the same hues dimmed rather than a fourth colour, because the week is context
   and today is the subject; _how far_ they dim is a token, not a number, because fading toward
   near-black desaturates as well as darkens and dark needs to fade less. Nothing else on screen
   carries a hue except the accent — on Record sale, the current-business ring, and the `Current`
   chip's border — and the red on a branch that did not close.

8. **A colour choice is a measurement, not a preference.** Every hue clears WCAG 3:1 against
   its own ground and stays at least 0.08 in OKLab distance from every other under normal vision
   and all three dichromacies — in both themes. `scripts/palette-check.mjs` prints the table and
   `tests/palette.test.ts` holds the floors, so a palette that looks nicer and reads worse fails
   the suite. This rule exists because the first palette here did exactly that.

## Breakpoints

Two, both Tailwind defaults. Adding a third is adding a layout somebody has to keep working.

|      | Width  | Arrangement                                                                 |
| ---- | ------ | --------------------------------------------------------------------------- |
| base | < 640  | One column. Branch on one line, keypad full width, commit at the bottom.    |
| `sm` | ≥ 640  | Top bar appears with the branch switcher. Composer and keypad side by side. |
| `lg` | ≥ 1024 | Left rail appears. Recent sales become a third column; tiles go 4 across.   |

## Colour

The base is shadcn `base-nova` with the `neutral` scale, which is chroma 0 throughout — a
deliberately colourless theme. Everything below is what was added to it, and it lives in an
appended block at the foot of `src/app/globals.css` rather than merged into the generated one,
because `shadcn init` and some `shadcn add` runs rewrite that block.

| Token                                           | Value                             | Job                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--background`                                  | `#fafafa`                         | The page ground. shadcn ships this pure white, which leaves a 1px border doing all the work of separating page from card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--card`                                        | `#ffffff`                         | The raised surface. 14px radius.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--commit`                                      | `#148b92`                         | Hue 202, chroma 0.095. **Three places, all enumerable:** the Record sale button, the ring around the rail dot for the business you are currently in, and the border of the `Current` chip on the branch list. The dot itself is that business's chart hue — the accent answers "which one am I in", the hue answers "which one is this", and the chip is that same question one level down, at the branch. Nowhere else: not a link, not a chart series, not the focus ring. **Never as text:** measured 4.09:1 on card and 3.92:1 on the ground, so it fails small text (4.5:1) in light while passing in dark at 5.88:1 — legible in one mode, deliberate-looking in both. It is a border, which is the graphical threshold it clears, and the chip's label stays `--foreground`. |
| `--commit-deep`                                 | `#10322f`                         | The chosen payment pill. The accent hue at 28% lightness: dark enough to read as ink, related enough that the pad and the commit button look like one control group. Its only other appearance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--good` / `--warn`                             | `#16a34a` / `#ca8a04`             | Direction on a number, in tile subtitles. Never a surface, never a fill.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--destructive-surface` / `-border` / `-strong` | `#fef2f2` / `#fecaca` / `#991b1b` | shadcn has one destructive colour; the un-closed-branch card needs three.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**No indigo, violet or purple — hue 255 to 320.** That is the family every generated
interface reaches for, and the theme shipped with exactly one chromatic value in it: a violet
`--sidebar-primary` that no one chose. It is corrected in the generated block rather than
shadowed by a later override, because a wrong value left in the file is a wrong value somebody
greps for and believes.

The band was **240–300 for one day**, and that was wrong. Those were round numbers rather than
measured ones, and they banned every blue worth having — Okabe and Ito's blue, the one colour in
the accessible set that clears 3:1 on both grounds, is hue 244. In OKLCH the family this rule is
about starts at Tailwind `indigo-500` (277) and runs through `violet-500` (292) to `purple-500`
(304); `blue-600`, the archetypal generated blue, is 263. So the low edge is 255: it still
refuses `blue-600` and everything above it, and admits a clean blue eleven degrees below. The
high edge is 320, which lets magenta through and keeps purple out.

Narrowing a rule to fit a colour would be cheating. Narrowing it because it was measured wrong
and was costing the chart its accessibility is the rule working — and `tests/design-tokens.test.ts`
carries a second assertion proving the moved band still catches `blue-600`.

## Chart colour

A single-series bar chart has nothing for colour to say, so the week chart is **stacked by
business** and the hue is the only thing telling you which slice is which. It carries the
information rather than brightening the page, which is the whole reason colour is allowed here.

These three are **Okabe and Ito's** blue, bluish green and vermillion — a qualitative palette
published for colour vision deficiency.

The first set here was cyan / pink / amber, picked because it looked good. `palette-check`
found that under tritanopia its pink and amber separated by an OKLab distance of **0.009**: for
those readers, two of the three series in the app were the same colour. Nothing on screen said
so and no test failed. Softening the chroma made every pair _worse_, because the problem was
hue choice and not saturation.

Of every trio measured, this is the only one where all three clear 3:1 against both grounds,
and it ties the best worst-case separation available:

|                  | Business     | Light     | Dark      | Contrast (light) |
| ---------------- | ------------ | --------- | --------- | ---------------- |
| `--biz-laundry`  | Laundry      | `#0172b2` | `#56a6e3` | 4.96:1           |
| `--biz-spa`      | Spa          | `#099e73` | `#55d1a3` | 3.28:1           |
| `--biz-skincare` | Skin Care    | `#d55e01` | `#f68a50` | 3.71:1           |
| `--biz-none`     | Unattributed | `#737373` | `#808080` | 4.53:1           |

Worst-case pairwise separation, across normal vision and all three dichromacies: **0.090** in
both themes, against a floor of 0.08. The pair that sets it is laundry/spa under tritanopia.

**There is deliberately no fourth business colour.** One that survives alongside these three
and the accent is not a guess — every candidate tried collided with the vermillion under
tritanopia at a distance of 0.006. A fourth business type means re-deriving the set with the
script, not appending to it. Until then `--chart-4` and `--chart-5` both point at the grey.

**The accent moved out of the way.** It was hue 184, nineteen degrees from the spa green and
separated from it by 0.046 — close enough to read as an accident. Hue 202 is the middle of the
gap between the blue and the green and nearly doubles that, to 0.086. Chroma is 0.095 rather
than 0.105 because 0.105 at that lightness falls outside sRGB, so the token would have named a
colour no screen can render.

`src/lib/business.ts` owns the type-to-colour mapping and is the only place it exists. The
colour comes back as a `var(--biz-*)` string rather than a Tailwind class, because
`bg-biz-${type}` is not in the source as a literal — Tailwind generates no utility for it and
the element renders unstyled, silently. Where the type is known at author time, `bg-biz-spa`
is the better spelling and exists.

**The domain tokens are the source and shadcn's numbered slots alias them**, not the reverse:
`--chart-2: var(--biz-spa)`. "Chart 2" is not something anyone reading a dashboard can look up,
and this way renaming a business is one line while a component reaching for `--chart-2` still
gets the right colour.

There is no chart library. The Worker is capped at 3 MiB compressed and a stacked bar is
flexbox.

## Theme

One theme, two modes, named **Counter**, defined in a single block at the foot of
`src/app/globals.css`. Every token has a light value and a dark value; there is no token that
exists in one mode and not the other, and `tests/palette.test.ts` runs the same floors against
both.

- **Light is the default, and the operating system is not consulted.** A blocking inline script
  in `layout.tsx` reads `localStorage` and turns dark on only for an explicit `"dark"`. It used
  to fall back to `prefers-color-scheme`, so a dark-mode device opened dark without anybody
  choosing — conventional, and rejected here: the owner asked for light, and this is a tool used
  in daylight at a counter rather than an app read in bed. A stored choice still wins in both
  directions.
- **Dark is still chosen before the first paint.** The script has to be blocking and inline;
  doing that work in an effect is what causes the white flash on a dark reload, and there is no
  way around it. It is a string literal with no interpolation.
- **`ThemeToggle` holds no React state.** The obvious version keeps the current mode in
  `useState` and renders the matching icon, which mismatches on hydration every time — the
  server cannot know what the browser chose. Both icons are in the markup and CSS picks:
  `dark:hidden` and `hidden dark:block`.
- **There is no toggle below `sm`,** deliberately. The phone layout has no chrome to hang one
  on, and the inline script already follows the operating system — which is the setting a phone
  user has actually made. A manual override belongs on the Settings screen when it exists, not
  on the four-tap screen.
- **`--chart-past` is a token because the right value differs per mode.** Fading a bar toward
  white leaves a pastel that still reads as the same hue; fading toward near-black desaturates
  and darkens at once, and at 0.45 the vermillion arrived as brown. Light 0.45, dark 0.6.

## Sizing

## Sizing

|             | Value                                |                                       |
| ----------- | ------------------------------------ | ------------------------------------- |
| Numpad key  | 62px mobile and tablet, 58px desktop | 12px radius                           |
| Method pill | 46px                                 | 999px radius                          |
| Record sale | 60px                                 | 14px radius, accent fill              |
| Card radius | 14px                                 | 16px on the desktop composer shell    |
| Type floor  | 11.5px                               | timestamps and tile subtitles only    |
| Body        | 13.5–15px                            | labels 12–12.5px                      |
| Figures     | mono, 17–52px                        | 600 weight, `-.02em` at display sizes |

The floors are exposed as Tailwind utilities — `h-key`, `h-pill`, `h-commit`, `max-w-pad` —
so a violation shows up in the markup instead of being a number somebody was supposed to
remember.

## What is enforced, and where

A design rule that lives only in prose drifts. These are the layers:

- **`tests/design-tokens.test.ts`** — no oklch hue in 255–320 above 0.05 chroma, and a second
  assertion that the moved band still catches `blue-600`; the accent stays in the teal family;
  every added token is defined for both light and dark; the three control floors hold; the
  keypad cap stays between 360 and 440px; and no variable refers to itself. Verified by
  reintroducing both the violet and the self-reference and watching the right test fail.
- **`tests/palette.test.ts`** — for each theme: every business colour declared, inside sRGB,
  clearing 3:1 against its own ground, and at least 0.08 from every other under normal vision
  and all three dichromacies. Plus that the numbered chart slots alias the domain tokens.
- **`tests/business.test.ts`** — the registry covers exactly the values the `business_type`
  enum declares, read out of the migration. Two hand-maintained lists in two languages, and the
  failure when they disagree is `BUSINESS[row.type]` returning `undefined` at render time.
- **`scripts/palette-check.mjs`** — prints the table the numbers in this file come from. Same
  maths as the gate, so the doc and the test cannot disagree.
- **`tests-e2e/counter.spec.ts`** — the rules that are only true in a browser, measured at 390,
  834 and 1440: four taps records a sale, a zero sale is refused, every control clears its
  floor, the pad stays capped, commit stays under the pad, nothing scrolls sideways, the rail
  appears only from 1024, the table only from 640, the week chart resolves three distinct
  colours, and the share percentages add to 100. Plus the theme: dark follows the OS on a first
  visit, the toggle is remembered across a reload, the dark chart keeps three distinct colours,
  and no measurement moves between modes.
- **`tests/chart.test.ts`** — the share percentages sum to exactly 100 across 200 random
  splits. Rounding each share independently gives 99 on the real numbers, and the bar would
  have a visible gap in it.
- **The utilities above** — a control shorter than its floor has to be written as a raw
  number to get there.
- **This file** — everything a test cannot express, which is most of the eight rules.

**A change to the design changes its guardrail in the same commit.** The alternative is what
already happened once here: a palette that had moved on while the value naming it stayed
behind.

## Deliberately not decided

- **The artboards are light only.** Dark is built, measured and rendered — see the Theme
  section — but the canvas was drawn light and stays that way: two sets of seven artboards is
  twice the drift surface for a mode the tests already hold to the same floors. Read dark at
  `/preview`, not on the canvas.
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
