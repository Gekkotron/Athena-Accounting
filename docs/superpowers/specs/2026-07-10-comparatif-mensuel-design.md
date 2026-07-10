# Comparatif mensuel — design

**Date:** 2026-07-10
**Status:** approved (design), pending implementation plan

## Goal

Add a "Comparatif mensuel" section to the Dashboard: a per-category
comparison of the **current (in-progress) month against the last complete
month**, showing each category's current total, previous total, the delta
(absolute + percentage), and a 6-month sparkline of that category's trend.

This is the first of three planned statistics features (Comparatif →
Insights panel → Sankey), each shipped independently. This spec covers
Comparatif only.

## Non-goals (YAGNI)

- No new backend endpoint — `/api/reports/categories` already returns
  everything needed.
- No per-category drilldown / click-through to transactions.
- No CSV export.
- No configurable comparison window or configurable sparkline length.
- No dedicated page or nav entry — it lives on the Dashboard.

## Data source

Reuse `GET /api/reports/categories`, which returns one row per
(category, month) over a date window:

```ts
interface CategoryReportRow {
  category_id: number | null;
  category_name: string | null;
  category_kind: CategoryKind | null;
  category_is_internal_transfer: boolean | null;
  month: string;            // "YYYY-MM"
  total: string;            // signed; expenses negative, income positive
  transaction_count: number;
}
```

The section fetches a **6-month window**: `fromDate` = the first day of the
month five months before the current month (so the window includes the
current month plus the five preceding months = 6 buckets), no `toDate`.
This single fetch feeds both the current/previous comparison and the
sparkline. It follows the exact pattern already used by
`CategoryBreakdown` and `MoyennesMensuellesSection`, including the account
scope (`accountId`) query param.

## Comparison semantics

- **current** = the row bucket equal to the current calendar month
  (`YYYY-MM` of today).
- **previous** = the bucket for last month.
- A category present in only one of the two months → the missing side is
  `0`, so "new this month" (previous 0) and "stopped" (current 0) both
  render a full delta.
- The current month is in progress. The header labels it clearly with a
  "· mois en cours" note so a partial-month delta is not misread as final.
  No projection/annualisation — we show the raw partial total.

## Aggregation rules (consistent with existing code)

Implemented as a pure helper so it is unit-testable in isolation:

```ts
// frontend/src/pages/Dashboard/helpers.ts
export type ComparatifMode = 'expense' | 'income';

export interface ComparatifRow {
  id: number | null;        // category id, or null for "Sans catégorie"
  name: string;
  color: string | null;
  current: number;          // absolute value of current-month total
  previous: number;         // absolute value of previous-month total
  deltaAbs: number;         // current - previous (absolute-value space)
  deltaPct: number | null;  // null when previous === 0
  spark: number[];          // 6 buckets, chronological, absolute values
}

export function buildComparison(
  rows: CategoryReportRow[],
  mode: ComparatifMode,
  currentMonth: string,     // "YYYY-MM"; injected (no Date in helper)
  months: string[],         // the 6 buckets, chronological; injected
): ComparatifRow[];
```

Rules inside `buildComparison`:

1. Skip rows where `category_is_internal_transfer` is true (matches
   `MoyennesMensuellesSection`).
2. Sign filter by mode: `expense` keeps rows with `total < 0`; `income`
   keeps rows with `total > 0`. `total === 0` and non-finite skipped.
3. Group by `category_id`. For each category, sum per month bucket
   (categories can have multiple rows per month only across splits, but
   the endpoint already groups by month, so this is effectively a lookup;
   summation is defensive).
4. `current` / `previous` are the absolute values of the current /
   previous month buckets (0 if absent).
5. `deltaAbs = current - previous`. `deltaPct = previous === 0 ? null :
   (deltaAbs / previous) * 100`.
6. `spark` = the six buckets in chronological order, absolute values,
   0 for absent months.
7. Sort by `current` descending, then `previous` descending, then name
   ascending (stable, deterministic — matters for tests).

The `currentMonth` and `months` array are injected as arguments rather than
computed inside the helper, so the helper is pure and tests don't depend on
the system clock. The section computes them from `new Date()` (via the
existing `Dashboard/helpers.ts` month utilities) and passes them in.

## Components

### `frontend/src/components/Sparkline.tsx` (new, presentational)

```ts
interface SparklineProps {
  values: number[];         // chronological
  color?: string | null;    // stroke; falls back to a neutral ink token
  width?: number;           // default ~72
  height?: number;          // default ~20
  'aria-label'?: string;
}
```

- Renders an inline `<svg>` with a single `<polyline>`, same SVG idiom as
  `CategoryDonut`. Scales values to the box (min→bottom, max→top). A flat
  series (all equal, including all-zero) renders a centered horizontal
  line. Single point renders a dot. No axes, no labels, no tooltip.
- Pure/presentational — no data fetching, no app state. Reusable by the
  later Insights feature.
- Uses `aria-label` for accessibility; decorative `<svg>` otherwise
  `aria-hidden` with the numeric values available in the row text.

### `frontend/src/pages/Dashboard/ComparatifMensuelSection.tsx` (new)

Props:

```ts
interface Props {
  currency: string;
  accountId?: number | 'all';
}
```

- Fetches the 6-month category report (react-query, same key shape as the
  other consumers, including the account scope).
- Holds the `Dépenses | Revenus` toggle (default `expense`), styled
  identically to the donut's toggle.
- Computes `currentMonth` + `months` from today, calls `buildComparison`,
  renders header + rows.
- Header: `Comparatif mensuel` section-rule with a subtitle
  `— {currentMonthLabel} vs {prevMonthLabel} · mois en cours` (French
  month names, lower-case, matching the app's existing tone).
- Empty state (no history / no rows for the mode): a `surface` panel with
  an italic hint, mirroring `MoyennesMensuellesSection`.

### Row layout

Each category row (a responsive grid, not a raw `<table>`, to match the
app's surface styling):

```
● Courses        1 240,00 €   1 090,00 €   +150,00 € (+13,8%)   ▁▂▃▅▂▆
  name+dot       current      previous     delta (colored)      sparkline
```

- Delta colour: for **expenses**, more-spent (deltaAbs > 0) is unfavourable
  → clay/negative tone; less-spent → sage/positive tone. For **income**,
  the mapping inverts (more income is favourable). Reuse the existing
  `amountSignClass` / tone tokens; a small `deltaTone(mode, deltaAbs)`
  helper keeps the mapping in one place.
- `deltaPct === null` renders as `nouveau` (previous 0, current > 0). A
  category that stopped (current 0) shows `-100,0%`.
- Amounts formatted via the existing `formatAmount(value, currency)`.

## Placement

In `frontend/src/pages/Dashboard/index.tsx`, add below the Répartition
donut section:

```tsx
{currencies.length > 0 && (
  <ComparatifMensuelSection currency={chartCurrency} accountId={chartScope} />
)}
```

It uses its own fixed 6-month window and is **independent of the page range
picker** — month-over-month comparison only makes sense on a monthly
window (same rationale as `MoyennesMensuellesSection`, which also ignores
the range picker). It does respect the account scope (`chartScope`), like
the donut.

## Testing

- `frontend/src/pages/Dashboard/__tests__/helpers.test.ts` (extend or new)
  for `buildComparison`:
  - sign filtering (expense vs income),
  - internal-transfer rows skipped,
  - `previous === 0` → `deltaPct === null`,
  - new category (previous absent) and stopped category (current absent),
  - sparkline length always 6 and chronological, zero-filled gaps,
  - sort order deterministic.
- `Sparkline` component test: renders a polyline for N points; flat series
  renders a horizontal line; single point renders a dot; respects
  `aria-label`.
- `ComparatifMensuelSection` test (react-query + mocked `api`):
  - toggle switches expense/income and re-filters,
  - empty state when no rows,
  - "mois en cours" indicator present in the header,
  - a row renders current/previous/delta text.

Matches the existing `Dashboard.test.tsx` and helpers-test conventions.

## Files touched

- New: `frontend/src/components/Sparkline.tsx`
- New: `frontend/src/pages/Dashboard/ComparatifMensuelSection.tsx`
- Edit: `frontend/src/pages/Dashboard/helpers.ts` (add `buildComparison`,
  `deltaTone`, and any month-window helper not already present)
- Edit: `frontend/src/pages/Dashboard/index.tsx` (render the section)
- New/edit tests as above.
- No backend changes. No API type changes (`CategoryReportRow` already
  exists).
