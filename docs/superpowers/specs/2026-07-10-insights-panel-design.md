# Insights panel — design

**Date:** 2026-07-10
**Status:** approved (design), pending implementation plan

## Goal

Add an "Insights" section to the Dashboard: a short, ranked list of
narrative money insights about the user's **last complete month**
(e.g. "Vos dépenses de juin : 2 140 € — +18 % vs mai"). Only *notable*
insights are shown, so the panel reads like a feed of things worth
knowing rather than a fixed grid of numbers.

This is the second of three planned statistics features (Comparatif →
**Insights** → Sankey). Comparatif mensuel was built then removed because
it compared an in-progress partial month against a complete one, so every
category showed a spurious drop for most of the month. **This feature
avoids that flaw by design: it only ever describes complete months.**

## Non-goals (YAGNI)

- No new backend endpoint — `/api/reports/categories` and
  `/api/reports/budget` already return everything needed.
- No data-hygiene insights (possible duplicates, newly-created
  categories). Those need backend work (a duplicate-detection endpoint, a
  `categories.created_at` column) and are deferred to a later feature.
- No configurable thresholds, no per-insight dismissal/muting, no
  drill-through to transactions.
- No projection / pro-rating of the current month.
- No dedicated page or nav entry — it lives on the Dashboard.
- Not account-scoped and not tied to the range picker (see Placement).

## Reference period

- **M** = the last *complete* calendar month (on 2026-07-10, `2026-06`).
- **M-1** = the month before M (`2026-05`).
- **Average window** = the last 12 complete months, identical to
  `MoyennesMensuellesSection` (`monthAgoISODate(12)` →
  `lastDayOfPrevMonthISODate()`), so "vs your average" clauses line up
  with the Moyennes numbers already on the page.
- The in-progress month is never described. Trade-off accepted: early in a
  month the panel talks about the month that just ended, which is the
  honest thing to show.

## Data sources

Both already exist; no backend changes.

1. `GET /api/reports/categories?fromDate=<12 complete months ago>&toDate=<last day of prev month>`
   — one row per (category, month), signed totals (expenses negative,
   income positive). Same fetch shape and `toDate` boundary as
   `MoyennesMensuellesSection`. Feeds spend/income totals per month,
   per-category movers, and the 12-month averages.

   ```ts
   interface CategoryReportRow {
     category_id: number | null;
     category_name: string | null;
     category_kind: CategoryKind | null;
     category_is_internal_transfer: boolean | null;
     month: string;            // "YYYY-MM"
     total: string;            // signed
     transaction_count: number;
   }
   ```

2. `GET /api/reports/budget?month=<M>` — budget-vs-spent for month M. The
   endpoint accepts an explicit `month` query param (defaults to current
   month if absent), so passing `M` keeps the budget insight on the same
   complete month as the rest of the panel.

   ```ts
   type BudgetReportRow = {
     categoryId: number; name: string; color: string | null;
     limit: string; currency: string; spent: string;
     remaining: string; pct: number; over: boolean;
   };
   type BudgetReport = { month: string; rows: BudgetReportRow[];
     totals: { limit: string; spent: string } };
   ```

## Aggregation and insight catalog

Implemented as a **pure, clock-independent helper** so it is unit-testable
in isolation (the analog of the removed `buildComparison`):

```ts
// frontend/src/pages/Dashboard/insights.ts

export type InsightTone = 'sage' | 'clay' | 'neutral';

export interface Insight {
  key: string;              // stable identity, e.g. 'spend-delta'
  icon: string;             // emoji
  headline: string;         // primary sentence (already formatted, French)
  detail: string | null;    // secondary line (delta chip text / names)
  tone: InsightTone;        // colour of the delta chip
  score: number;            // severity, for ranking (higher = more notable)
  spark?: number[];         // optional 6-month trend, chronological
}

export function buildInsights(
  categoryRows: CategoryReportRow[],
  budgetRows: BudgetReportRow[],
  months: string[],         // the complete-month window, chronological
  referenceMonth: string,   // "YYYY-MM" == M; injected (no Date in helper)
  currency: string,
): Insight[];
```

Shared preprocessing (mirrors existing code):

- Skip rows where `category_is_internal_transfer` is true and rows whose
  `Number(total)` is non-finite (consistent with
  `MoyennesMensuellesSection` / the former `buildComparison`).
- Bucket signed totals by month to get `spend(month)` (sum of negative
  totals, as a positive magnitude) and `income(month)` (sum of positive
  totals) for every month in the window.
- `prevMonth` = the entry immediately before `referenceMonth` in `months`
  (may be absent if the window is short → those deltas are skipped).
- 12-month averages: mean of `spend`/`income` across the window's complete
  months (matches Moyennes' definition).

Candidate insights (each yields an `Insight` or `null`; `null` when not
notable). Thresholds are module constants:

| key | icon | headline | notable when | score |
|-----|------|----------|--------------|-------|
| `spend-delta` | 📉/📈 | `Vos dépenses de {M} : {spend}` + detail `{±Δ%} vs {M-1}` (append ` · au-dessus/en-dessous de votre moyenne` when spend also deviates ≥10% from the 12-mo average) | `\|Δ%\| ≥ 10` | `\|Δ%\|` |
| `income-delta` | 💰 | `Vos revenus de {M} : {income}` + detail `{±Δ%} vs {M-1}` | `\|Δ%\| ≥ 10` | `\|Δ%\|` |
| `savings` | 🐷/⚠️ | `Vous avez épargné {savings} en {M} ({rate}% de vos revenus)`; if savings < 0 → `⚠️ Vous avez dépensé plus que vos revenus en {M}` | savings < 0, OR `\|rate − avgRate\| ≥ 10` points | `100` if negative, else `\|rate − avgRate\|` |
| `top-increase` | 🔺 | `Plus forte hausse : {cat}` + detail `+{Δ} (+{Δ%}) vs {M-1}` (detail reads `nouveau` when M-1 ≈ 0) | increase ≥ `MOVER_MIN` (absolute) **and** ≥ 30% (or M-1≈0) | `\|Δ%\|` of the category (capped at 100 so a from-zero jump doesn't dominate forever) |
| `top-decrease` | 🔻 | `Plus forte baisse : {cat}` + detail `−{Δ} (−{Δ%}) vs {M-1}` | drop ≥ `MOVER_MIN` and ≥ 30% | `\|Δ%\|` of the category |
| `budget-overruns` | ⚠️ | `{n} budget(s) dépassé(s) en {M}` + detail = category names (capped, "…") | `n ≥ 1` (count of `over` rows) | `50 + 10·n` |

Scores share one scale so they are directly comparable: the delta and
mover insights score on percentage magnitude; a negative-savings month is
pinned to `100` so it always surfaces; budget overruns use `50 + 10·n` so
they rank strongly whenever present. Ranking: sort by `score` descending;
break ties by a fixed catalog order (the table order above). Take the
**top 4**. The `spend-delta` and
`income-delta` insights carry `spark` (their 6-month trend, chronological,
zero-filled) for the sparkline; others omit it.

Tone: for spend, an increase is unfavourable (`clay`), a decrease
favourable (`sage`); for income and savings the mapping inverts. A tiny
local `tone(kind, delta)` keeps the mapping in one place (the old
`deltaTone` was removed with Comparatif; this is a small re-introduction
scoped to insights).

All month keys and the reference month are **injected as arguments**, so
the helper never reads the clock and tests are deterministic — the same
discipline used by the former `buildComparison`.

## Component

### `frontend/src/pages/Dashboard/InsightsSection.tsx` (new)

Props:

```ts
interface Props {
  currency: string;   // the primary currency, like MoyennesMensuellesSection
}
```

- Computes the window (`monthAgoISODate(12)` → `lastDayOfPrevMonthISODate()`)
  and `referenceMonth` (last complete month) from today via the existing
  `Dashboard/helpers.ts` utilities, then passes them into `buildInsights`.
- Two react-query fetches, keys matching existing consumers:
  - `['reports','categories',{fromDate,toDate}]` (same key as Moyennes so
    the cache is shared),
  - `['reports','budget',{month: referenceMonth}]`.
- Loading: a `surface` skeleton block, mirroring the other sections.
- Error: if the categories query errors, show a `surface` error line
  (`clay`), matching the app's error convention. A budget-query error is
  non-fatal — the panel still renders the money insights and simply omits
  the budget one.
- Empty (no insight clears its threshold, or no history): a `surface`
  panel with an italic hint (`Rien de notable ce mois-ci.`), mirroring
  `MoyennesMensuellesSection`'s empty state.
- Otherwise: a `surface` list of insight rows. Each row = emoji + headline
  (primary text) + a secondary detail line whose delta chip is coloured by
  `tone`. The `spend-delta` / `income-delta` rows render a `Sparkline`
  (reusing `frontend/src/components/Sparkline.tsx`) of the 6-month trend.
- Header: `Insights` section-rule with a subtitle
  `— {referenceMonthLabel}` (French lower-case month name), matching the
  tone of the Moyennes / former Comparatif headers.

### Row layout

```
📉  Vos dépenses de juin : 2 140,00 €              ▁▂▃▅▂▆
    +18 % vs mai · au-dessus de votre moyenne
🔺  Plus forte hausse : Restaurants
    +150,00 € (+38 %) vs mai
⚠️  2 budgets dépassés en juin
    Courses, Loisirs
```

A responsive grid/flex `surface`, not a raw table, consistent with the
app's surface styling. Amounts via the existing `formatAmount(value,
currency)`; percentages formatted `+18,0 %` (comma decimal, matching the
former Comparatif formatting).

## Placement

In `frontend/src/pages/Dashboard/index.tsx`, render **directly below
`MoyennesMensuellesSection`** (which is currently the block gated on
`primary`, before the filters card). This groups the two clock-independent
monthly-window summaries into one stats cluster near the top, before the
range-filtered charts.

```tsx
{primary && <MoyennesMensuellesSection currency={primary.currency} />}
{primary && <InsightsSection currency={primary.currency} />}
```

Like Moyennes, the section is **global (all accounts)** and **independent
of the range picker** — it is a "your finances this month" summary, not a
filtered view. (The budget endpoint is not account-scoped either.)

## Testing

- `frontend/src/pages/Dashboard/__tests__/insights.test.ts` for
  `buildInsights` (the replacement for the removed `helpers.test.ts`):
  - reference month is the injected complete month; deltas computed vs the
    prior month in the window,
  - internal-transfer rows skipped; non-finite totals skipped,
  - `spend-delta` / `income-delta` appear only past the 10% threshold, with
    correct tone and the "vs average" clause when applicable,
  - `savings` flags negative savings with the highest score; rate-vs-average
    branch,
  - `top-increase` / `top-decrease` pick the largest mover, honour
    `MOVER_MIN`, and label a from-zero jump as `nouveau`,
  - `budget-overruns` counts only `over` rows and lists names,
  - ranking returns the top 4 by score, deterministic tie-break,
  - empty result when nothing clears a threshold.
- `frontend/src/pages/Dashboard/__tests__/InsightsSection.test.tsx`
  (react-query + mocked `api` for both endpoints):
  - renders notable rows with headline + detail text,
  - empty state when `buildInsights` returns `[]`,
  - loading skeleton before data arrives,
  - reference-month label present in the header,
  - a budget-query error still renders the money insights.

Matches the existing `Dashboard` test and helper-test conventions.

## Files touched

- New: `frontend/src/pages/Dashboard/insights.ts` (pure helper + types)
- New: `frontend/src/pages/Dashboard/InsightsSection.tsx`
- New: `frontend/src/pages/Dashboard/__tests__/insights.test.ts`
- New: `frontend/src/pages/Dashboard/__tests__/InsightsSection.test.tsx`
- Edit: `frontend/src/pages/Dashboard/index.tsx` (render the section)
- Reuse (no change): `frontend/src/components/Sparkline.tsx`,
  `frontend/src/pages/Dashboard/helpers.ts` month utilities.
- No backend changes. No API type changes (`CategoryReportRow`,
  `BudgetReportRow` already exist).
