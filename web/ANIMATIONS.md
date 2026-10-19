# Animations

The web app uses two animation tools, each for a different job:

| Tool         | Package                   | Used for                                                                                              |
| ------------ | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Motion**   | `motion` (`motion/react`) | Anything React renders: entrances, exits, layout changes, sliding highlights, springs, and the charts |
| **anime.js** | `animejs` (v4)            | Imperative effects on a value or an SVG path: count-up numbers, the drawn logo                        |

Overlap is fine: Motion owns components and the charts, anime.js owns numbers
and the logo's stroke. The charts are plain SVG in `src/components/Charts.tsx`,
with no chart library (see below).

## Rules that keep it smooth

These came from bugs, so keep them in mind when adding animation.

1. **Never offset content with `y`/`x` on entrance.** A translated element still
   counts toward the page's scroll height, so the page briefly grows and a
   scrollbar flashes. Enter with `opacity` and `scale` from `0.96–0.98` instead
   (an element that starts smaller can't outgrow the page). The only `x` slide
   left is a recent-activity row entering from the _left_, inside a list that
   clips its overflow.
2. **Don't put `initial={false}` on an `AnimatePresence` that wraps a page.**
   Motion passes it down: every `motion.*` inside the page then skips its
   `initial` state, even elements that mount later. The page wrapper in
   `Shell.tsx` has a comment about this. `initial={false}` is fine on small,
   self-contained presences (a label swap, a list).
3. **Use `mode="popLayout"` for lists that must keep their size.** The leaving
   item is taken out of the layout at once, so a list of N never briefly holds
   N + 1 rows (Recent activity, Where it went, the pager numbers).
4. **Prefer a shared `layoutId` over animating `left`/`top`.** One element
   with the same `layoutId` in each place makes Motion slide it between them.
   Don't use it inside something that is itself scaling in (a dialog zooming
   open): it gets measured mid-zoom and lands in the wrong place. The
   expense/income switch in the transaction dialog uses a plain background for
   that reason.
5. **Wait for a real size before drawing a chart.** A chart that animates in a
   0×0 box finishes before anyone sees it. `BarChart` renders nothing until its
   container is measured.
6. **Springs, not durations, for things that move.** Common values:
   `stiffness 500, damping 38–40` for snappy highlights, `280, 30` for chart
   bands and list reordering, `300, 30` for card entrances, `180–200, 26` for
   bars and rings that change length.
7. **Run things in parallel; don't chain them.** Waiting (`mode="wait"`),
   staggers and delays add up: the dashboard once took ~1.5 s to settle with
   each piece fine on its own. Everything now starts together and settles in
   about 0.9 s, so the slowest single animation sets the pace.

## Shell (`src/components/Shell.tsx`)

| What              | How                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page change       | `AnimatePresence mode="popLayout"` keyed by pathname; the new page fades in (0.12 s) while the old one fades out on top of it (opacity only, rule 1).    |
| Sidebar highlight | `layoutId="nav-active"`: one pill springs between links. The nav has `md:overflow-visible`, otherwise the pill briefly overflowing it shows a scrollbar. |

There is no top header bar: pages don't spend vertical space on a title strip.
The sidebar is a brand row (logo + `CFlow` wordmark, "Personal finance"
underneath), the nav (Dashboard, Transactions, Settings) and a log-out button at
the bottom. Theme is managed from the Settings page.

## Dashboard (`src/pages/Dashboard.tsx`)

**On load.** Each card is a `motion.div variants={rise}` (opacity 0 → 1,
scale 0.98 → 1, spring `300, 30`), and all of them appear at once (rule 7).

**Numbers.** Every amount in the stat cards uses `<Money countUp />`, which
rolls from its previous value to the new one with anime.js (700 ms,
`outExpo`). The "x% saved" in the ring uses the same hook (`useCountUp`).
Switching month rolls from the old figure, not from zero.

**Income vs spending (bar chart).**

- On mount, each bar grows from the baseline (a `motion.rect` from
  `height: 0`), all at once, on a `200, 26` spring.
- The chart is keyed by **year**. Switching months within a year keeps the
  bars; only the highlight band moves. Crossing into another year remounts it
  and the bars grow again.
- The highlight band is a `motion.rect` that springs its `x` to the selected
  month's slot. Hovering a month dims the others and shows its values.

**Where it went.** Each row is a `motion.li` with `layout`, so rows glide to
their new order when categories rank differently between months. Rows that
appear or leave fade (`popLayout`). Each bar's width springs to its new share
from its current width.

**Recent activity.** Rows are `motion.li` with `layout` in a clipped list with
`popLayout`. A new transaction slides in at the top, the others slide down and
the last one fades without the card growing. Avatar and chevron nudge on hover
(CSS transitions).

**This month (rings).** Each ring is a stroked `motion.circle` whose
`strokeDashoffset` is the empty part. On mount the arcs sweep in from empty;
on a new month they spring from where they are, so each arc extends or
retracts instead of jumping. Spent is the inner ring, kept the outer; both are measured
against income, and spending past income fills the inner ring.

## Transactions (`src/pages/Transactions.tsx`)

**Pager.** Page numbers are `motion.div`s with `layout` inside
`AnimatePresence mode="popLayout"`, so when the visible window of pages shifts
the numbers glide, new ones scale in and old ones scale out. Gaps (`…`) are
keyed by side so the one before the current page stays itself. The current
page has a pill with `layoutId="page-active"` that springs to the clicked
number. Number buttons have no hover background: the numbers move under a
still cursor, and a hover background would show on the wrong one.

## Transaction dialog (`src/components/TransactionDialog.tsx`)

- The dialog itself uses shadcn's zoom/fade (`tw-animate-css` classes on the
  Radix `data-state`).
- **Save button**: `SwapLabel` slides its label vertically between
  "Add expense" → spinner → check, then the dialog closes ~300 ms later.
- **Delete**: same `SwapLabel` for "Delete" → "Confirm delete" (reverts after
  3 s).

## Settings (`src/pages/Settings.tsx`)

- Section nav: `layoutId="settings-active"` pill follows the section at the
  scroll reference line, picked by a rAF-throttled scroll listener (so it tracks
  both scrolling and clicking a link, which scrolls the section into view).
- Category lists are plain rows (no enter/exit animation).

## Login (`src/pages/Login.tsx`, `src/components/Logo.tsx`)

- The card springs in from 96% scale.
- The "B" logo draws itself with anime.js: `svg.createDrawable(path)` animated
  from `draw: "0 0"` to `"0 1"` over 0.6 s (`outCubic`: fast start, soft finish). The same logo shows (drawing) while
  the app checks the session, and the sidebar's brand logo draws the same way on
  app mount.

## Charts (`src/components/Charts.tsx`)

Two components, plain SVG and Motion, no chart library or `@visx/*` packages:

- **`BarChart`**: one slot per row (`width / rows`), grouped bars inside it,
  y from 0 to the data maximum rounded up to 1, 2, 2.5 or 5 × 10ⁿ, four dashed
  grid lines, a highlight band for `selected`, and a hover tooltip. It measures
  its container with a `ResizeObserver` and draws nothing until it has a size
  (rule 5).
- **`RingChart`**: concentric rings, `rings[0]` innermost. Each is a circle
  with `strokeDasharray` set to its circumference; animating
  `strokeDashoffset` shows the progress. An empty ring hides its stroke,
  since a round line cap would still show a dot.

## Reduced motion

`useCountUp` and the logo drawing check `prefers-reduced-motion` and jump
straight to the end state. Motion animations (including the charts) do not
yet; wrapping the app in `<MotionConfig reducedMotion="user">` would make
Motion respect it.

## Tests

`tests/setup.ts` sets `MotionGlobalConfig.skipAnimations = true`: happy-dom
rejects the Web Animations Motion cancels, and tests only check end states.
anime.js count-ups still run, so tests wait for the final value with
`waitFor`.
