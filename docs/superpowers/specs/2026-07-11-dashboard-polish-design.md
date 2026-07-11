# Dashboard Polish — Design

**Date:** 2026-07-11
**Status:** Design approved, awaiting user review
**Author:** Gekkotron + Claude (brainstorming session)
**Related:** small deliverable that lives inside the future spec #4 (Dashboard
rethink) but ships now as an independent polish pass.

## Context

Three user-reported issues on the Dashboard:

1. **`Flux · EUR` header lacks parity with Insights.** Insights has a
   trailing period suffix + a `‹ ›` chip in the top-right for stepping the
   reference month. Sankey has just a plain `section-rule` label.
2. **The dashboard has three interacting controls** — Insights arrows
   (per-month), page RangePicker (30 j / 3 m / 6 m / 12 m / Tout), account
   scope select — and the RangePicker/account block sits **between**
   Insights and the graphs it drives. Users find the mental model
   scattered.
3. **Amounts in the Sankey graph are hard to read** at their current size
   and colour (`fill-ink-500 text-[10px]` on a dark background near
   coloured ribbons).

## Goals

- Give the Sankey section a header matching Insights' shape (title —
  suffix + `‹ ›` chip).
- Move the page-level filter block (RangePicker + account select) up to
  sit right after the DashboardHero, so it reads as the page's control
  strip.
- Improve node-amount readability in the Sankey.
- No new colour, spacing, typography, or chart-library tokens — reuse
  existing `ink-*`, `sage-*`, `clay-*`, `section-rule`, `label`, and
  Tailwind sizes already present.

## Non-goals

- No full dashboard redesign (that's spec #4).
- No change to Insights' month-stepping behavior — it operates on
  complete-month windows and stays as it is.
- No new API calls, no backend changes, no schema changes.
- No change to the Sankey layout algorithm — the ribbon geometry stays.

## Part 1 — Sankey header parity

Current Sankey header:

```
Flux · EUR
   Sources          Revenus          Postes
                    12 345 €
```

Target Sankey header:

```
Flux · EUR — sur 6 mois                  [ ‹  › ]
   Sources          Revenus          Postes
                    12 345 €
```

- Suffix text is the return value of the existing
  `rangeSuffixLabel(range)` helper in `frontend/src/components/RangePicker.tsx`:
  - `30d`  → "sur 30 jours"
  - `3m`   → "sur 3 mois"
  - `6m`   → "sur 6 mois"
  - `12m`  → "sur 12 mois"
  - `all`  → "depuis l'ouverture"
- Suffix uses the exact same muted trailing style as Insights (`text-ink-500
  font-normal text-xs normal-case tracking-normal`).
- The `‹ ›` chip uses the exact class stack from Insights:
  `inline-flex rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs`
  around two buttons with
  `px-2.5 py-1.5 rounded-md text-ink-400 transition hover:text-ink-100
  disabled:opacity-30 disabled:hover:text-ink-400`.
- Chevron direction convention matches Insights: `‹` steps to the
  next-**longer** period ("further back"), `›` steps to the
  next-**shorter** period. Chip disables buttons at the ends.
- The chip mutates the **shared page `range`** (not a local `SankeySection`
  state). That way Évolution and Répartition update in step. The mid-page
  RangePicker (in the moved filter block, Part 2) stays authoritative;
  the chip is a compact secondary surface tied to the same state.
- The 3-column caption row below (Sources / Revenus / Postes) is unchanged.
- The existing `Sankey.tsx` component itself is untouched; the change
  lives entirely in `SankeySection.tsx`, which now receives an
  `onRangeChange` callback in addition to `range` and `currency`.

**New `SankeySection` props:**

```ts
interface Props {
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  currency: string;
}
```

## Part 2 — Filter block moves to the top

The `<section className="surface p-4 md:p-5 flex flex-col gap-3">` that
contains the account `<select>` and `<RangePicker>` moves from its current
position (between Répartition and the graphs) to sit **right after
`<DashboardHero />`** and the "Other currencies" strip, and **before**
`MoyennesMensuellesSection`. Rationale:

- The filter drives Évolution + Répartition + Flux — three of the four
  primary graph sections. A control that drives most of the page belongs
  at the top of the page, not buried mid-scroll.
- Insights stays independent (its month arrows are a reference-month
  axis, not a date-range window). Users see Insights as "here's what
  happened last complete month" and the filter block as "over this
  range, show me the trends" — two axes, two controls, both
  self-labeled.

**New order of sections:**

```
DashboardHero
Other-currencies strip
Filter block (RangePicker + account select)   ← moved
MoyennesMensuellesSection
InsightsSection
Évolution
Répartition
SankeySection (with new header + arrows)
```

- The filter block's rendered markup is unchanged. Only its position in
  the JSX moves.
- Loading gate stays: the filter block is still guarded by
  `currencies.length > 0`.

## Part 3 — Sankey amount readability

Two changes inside `Sankey.tsx`, node-label rendering block:

- Label: `fill-ink-100 text-[11px]` → stays (already legible).
- Amount: `fill-ink-500 text-[10px] tabular-nums` → **becomes**
  `fill-ink-300 text-[11px] tabular-nums` on hover-idle, and
  `fill-ink-50` on the hovered node.
- Vertical spacing of the two-line node label: the current 4-pixel gap
  between label and amount stays, so the ~1 px extra font-size doesn't
  cause them to touch. If they do touch at small node heights, bump the
  amount's `y` offset by 1 pixel.

The change is a two-line edit in `Sankey.tsx` (the two `<text>` elements
inside the `nodes` mapping), guarded by a single new `isHi` branch on the
amount fill.

## Architecture / file changes

**Modified:**

- `frontend/src/pages/Dashboard/index.tsx` — reorder JSX to move the
  filter block; pass `onRangeChange={setRange}` down to
  `<SankeySection />`.
- `frontend/src/pages/Dashboard/SankeySection.tsx` — add
  `onRangeChange` prop; render the Insights-style header (title suffix
  + `‹ ›` chip); keep the existing `<Sankey>` render below.
- `frontend/src/components/Sankey.tsx` — bump node-amount contrast per
  Part 3.

**New:** none.

**Deleted:** none.

## Testing

- Update `SankeySection.test.tsx` (if it exists — otherwise add one):
  assert the header renders with the correct French suffix for each
  `RangeKey`, `‹`/`›` clicks call `onRangeChange` with the expected
  neighbour, endpoint disabled states hold.
- Update `Dashboard.test.tsx` if it currently asserts the filter block's
  position (it likely doesn't).
- No new assertions needed on `Sankey.tsx` for the colour bump; the
  component's existing visual is not covered by DOM-content tests.

## Rollout

- Ship as one PR / one commit on `main`. No feature flag, no migration.
- No backend changes.

## Open questions

None.

## Next step

Write the implementation plan (`writing-plans`) once this design is
approved.
