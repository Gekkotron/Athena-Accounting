# Average-based balance projection on the dashboard Trend chart

**Date:** 2026-07-30
**Status:** approved

## Problem

The dashboard Trend chart's « Voir la projection » overlay extrapolates the
balance from **confirmed recurring series** (`projectBalance` in
`frontend/src/lib/recurring-forecast.ts`). In practice users confirm their
income series (salary) but few of their outflows, so the projection staircases
upward (+avgAmount per salary) while the historical curve oscillates near a
flat trend. On a real dataset the history sits between 0 and ~4 k€ for a year
and the 6-month projection climbs to 15,5 k€ — visually and numerically
inconsistent with the data it extends.

## Decision

Replace the dashboard overlay's data source with **historical averages** so
the projected slope matches the observed trend. The recurring-series engine
(`projectBalance`) and the Récurrent → Prévision tab are unchanged.

## Projection shape — sawtooth

One pure generator in a new `frontend/src/lib/average-forecast.ts`:

```ts
projectAverageBalance({
  startBalance: number,
  avgMonthlyIncome: number,   // positive
  avgMonthlySpend: number,    // positive magnitude
  horizonDays: number,        // 180, same cap as today
  startDate: string,          // YYYY-MM-DD (today)
}): Array<{ date: string; value: number }>
```

- On the **1st of each projected month**: a `+avgMonthlyIncome` step (the
  "salary lands" spike).
- **Every day** (including the remainder of the current, partial month): a
  `−avgMonthlySpend / daysInMonth(month)` drift.
- Net change per full month = `avgMonthlyIncome − avgMonthlySpend` = average
  savings, so the projection's trend always matches history.
- Day arithmetic is UTC-safe ISO math, same idiom as `recurring-forecast.ts`.
- `startBalance` anchoring is unchanged from today's overlay: the
  per-currency total from `/api/reports/balance` for scope 'all', the
  account's `currentBalance` (fallback `openingBalance`) for a single
  account.
- Output feeds the existing `projection` prop of `BalanceChart` — dashed
  rendering, X-axis extension, and the "measured now" end marker already work.

## Where the averages come from

### Scope « Tous les comptes »

`avgIncome` / `avgSpend` from the categories report
(`/api/reports/categories`) over the last **12 complete months** — exactly
the computation of the Moyennes mensuelles tiles
(`pages/Dashboard/MoyennesMensuellesSection.tsx`): skip
`category_is_internal_transfer` rows, bucket signed totals per month, divide
by the number of months present. The tiles and the projection therefore
always display the same numbers. The Dashboard already issues this query with
the same key; React Query dedupes it. The shared per-month aggregation moves
to a small pure helper so the section and the projection can't drift apart.

### Scope single account

Internal transfers DO move a single account's balance, so category-based
averages (which exclude them) would over- or under-state the slope. Instead,
derive the averages from the account's own balance history (the timeseries
query already returns full history; the range filter is client-side):

- Per **complete calendar month** in the account's series: sum of positive
  day-over-day balance deltas = inflow; sum of negative deltas = outflow
  (magnitude).
- `avgMonthlyIncome` / `avgMonthlySpend` = mean of those monthly sums over
  the available window, capped at the last 12 complete months.
- A helper `monthlyFlowAverages(points: BalancePoint[])` in
  `average-forecast.ts` owns this; it operates on the already-scoped,
  currency-filtered aggregated series.

## Edge cases

- **No complete month of history** (or an empty scoped series): no
  projection — the overlay is silently absent, matching today's behavior
  when no recurring series exist.
- **Fewer than 12 complete months**: average over the months that exist.
- **Current partial month**: never contributes to the averages (consistent
  with the Moyennes window) but does receive the daily spend drift from
  `startDate` to month-end; the next income step lands on the upcoming 1st.

## UI

- The « Voir la projection » checkbox and the `showForecast` setting keep
  their names and behavior (on/off, persisted in Réglages).
- Its tooltip changes to say the projection is based on the monthly averages
  (income/spend) rather than recurring series, and moves from the hardcoded
  French string in `pages/Dashboard/index.tsx` into the dashboard i18n
  namespace (both locales).

## Cleanup

- Remove the `recurringQ` query and the `projectBalance` /
  `RecurringSeries` imports from `pages/Dashboard/index.tsx`.
- `lib/recurring-forecast.ts` stays — the Récurrent Prévision tab still uses
  it.

## Testing

Frontend vitest, pure functions first:

- `projectAverageBalance`: income step on the 1st, daily drift within a
  month, partial first month (start mid-month → drift only until the 1st,
  then step), month-length variation (28/30/31 days), horizon cap, net
  monthly change equals income − spend.
- `monthlyFlowAverages`: empty series, series shorter than one complete
  month → null, partial current month excluded, inflow/outflow split on a
  known sawtooth fixture, 12-month cap.
- Dashboard wiring: overlay present for scope 'all' with history, absent
  with no history; existing tests referencing the recurring forecast updated.
