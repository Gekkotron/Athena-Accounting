# Dashboard Sankey — cash-flow diagram

**Date:** 2026-07-10
**Status:** Approved (design)
**Type:** Dashboard statistics element (3rd and final of the stats roadmap)

## Summary

Add a Sankey diagram to the Dashboard that visualizes cash flow for the
selected period: income sources flow into a central "Revenus" pool, which
splits out to expense categories (rolled up to parents) plus an "Épargne"
node for the surplus. It is the last item of the Dashboard statistics roadmap
(after the removed monthly comparison and the shipped Insights panel).

## Goals

- Show, at a glance, where the money came from and where it went over a range.
- Read as part of the existing Dashboard system — same surfaces, tone, and
  hand-rolled-SVG convention as `CategoryDonut` / `Sparkline` / `BalanceChart`.
- Zero new runtime dependencies; frontend-only (no backend/migration change).

## Non-goals (v1)

- Hover tooltips / interactivity, drill-down into a node, animation.
- Accessible data-table fallback (may be added later).
- Per-account filtering.
- Two-level (parent → child) flows; a charting library; a dedicated endpoint.

## Decisions (from brainstorming)

- **Flow shape:** Income → central "Revenus" pool → expense destinations +
  Épargne. The canonical personal-finance cash-flow Sankey.
- **Time scope:** Follows the existing Dashboard `RangePicker` (`range` state
  in `Dashboard/index.tsx`), same as the balance chart and donut.
- **Node grouping:** Roll leaf categories up to their parent (`parentId`);
  show top N parents by amount, bundle the rest into `Autres`. Applied to both
  the income and expense sides. Default N = 6 on the expense side and 4 on the
  income side, defined as constants so they can be tuned without touching
  logic.
- **Data approach (A):** Frontend-only. Reuse `/api/reports/categories`
  (already range-aware, transfers excluded, splits handled via the
  `tx_effective` CTE) + `/api/categories` (for `parentId` and `color`). Roll up
  and split by `kind` client-side.
- **Rendering approach (A):** Hand-rolled inline SVG. No `d3-sankey` / no
  charting lib — consistent with the rest of the project.

## Diagram structure & flow conservation

Three columns, left → right:

1. **Income sources** (left): income-kind categories, rolled to parents,
   top N + `Autres`. Node height ∝ amount.
2. **Revenus** (center): single pool node = total income. All income ribbons
   converge here.
3. **Destinations** (right): expense parents (top N + `Autres`) **plus** an
   **Épargne** node.

Balance cases (a Sankey must conserve: total-in == total-out):

- **Surplus (income > expenses):** `Épargne = income − expenses`, drawn as a
  distinct calm-toned (`sage`) node — "what you kept".
- **Deficit (expenses > income):** no Épargne node; instead a
  **`Épargne puisée`** *source* node is added on the **left** feeding the pool,
  height = `expenses − income`, in the `clay` tone. This keeps in/out balanced.

Edge cases:

- **No income in range:** the pool would be 0 and cannot render meaningfully →
  show an empty-state message ("Pas de revenus sur la période").
- **Categories with net amount ≤ 0:** Excluded from the diagram and totals.
  A Sankey ribbon cannot have negative width, so expense groups that net to zero
  or negative over the period (e.g. categories dominated by refunds) are
  intentionally filtered out. This is a characterization, not a bug.
- Expense totals are stored negative → negate to positive for display, same as
  the budget report.
- Internal transfers already excluded server-side; guard again client-side.

## Components & data flow

Mirrors the `insights.ts` (pure) + `InsightsSection.tsx` (fetch/render) split.

- **`frontend/src/pages/Dashboard/sankey.ts`** — pure, no React:
  - `buildSankeyModel(reportRows, categories, currency, topN)` →
    `{ incomeNodes, expenseNodes, savings, deficit, totalIncome, totalExpense }`.
    Rolls leaves → parents via `parentId`, splits by `kind`, excludes internal
    transfers, applies top-N + `Autres`, negates expenses.
  - `layoutSankey(model, { width, height, ... })` → node rects
    `{ x, y, w, h, label, color, amount }` + links `{ path }` (cubic-Bézier
    `d` strings). Pure geometry, fully unit-testable.
- **`frontend/src/components/Sankey.tsx`** — presentational. Takes the layout,
  renders `<svg>` with `<rect>` nodes + `<path>` ribbons + labels. No data
  logic.
- **`frontend/src/pages/Dashboard/SankeySection.tsx`** — Dashboard section
  wrapper. Consumes `range` (prop from `index.tsx`, like `CategoryBreakdown`),
  fetches `/api/reports/categories` (with `fromDate` from `fromDateFor(range)`)
  + `/api/categories`, feeds `buildSankeyModel`, handles loading / error /
  empty. Uses React Query so the categories report cache is shared with the
  donut.

**Placement:** new `<section>` in `Dashboard/index.tsx`, right after the
"Répartition par catégorie" donut (both range-driven, so they sit together
below the range picker). Title `Flux · {currency}` in the `section-rule` style.

## Rendering, responsiveness & accessibility

- `viewBox`-based SVG scaled to container width (`width: 100%`,
  `preserveAspectRatio`) — responsive with no JS resize listener, same trick as
  `CategoryDonut` / `Sparkline`.
- Node colors from `categories.color`; `Autres` uses a neutral `ink-*` token;
  `Épargne` uses `sage`, `Épargne puisée` uses `clay` (Insights tone palette).
- Ribbons carry the source node's color at reduced opacity.
- Labels: category name + `formatAmount`. (Share-of-total % on labels was
  deferred from v1 — the totals are conveyed by node height; a follow-up may
  add the percentage.)
- Small screens: labels sit outside nodes; if cramped, the SVG scrolls
  horizontally inside an `overflow-x-auto` wrapper (never breaks page layout).
  A minimum node-height floor keeps tiny categories legible; anything below the
  floor falls into `Autres`.
- Accessibility: `role="img"` + `aria-label` summarizing totals.

## Testing (TDD)

- **`sankey.test.ts`** (primary coverage): parent rollup, top-N + `Autres`
  bundling, expense negation, surplus vs deficit branch, internal-transfer
  exclusion, empty-income case.
- **`layoutSankey`** geometry invariants: node heights sum correctly, no
  negative dims, conservation (Σ income heights == Σ destination heights).
- One `SankeySection` render test (loading → data → empty), following
  `Dashboard.test.tsx` patterns.

## Files touched

- Add: `frontend/src/pages/Dashboard/sankey.ts`
- Add: `frontend/src/components/Sankey.tsx`
- Add: `frontend/src/pages/Dashboard/SankeySection.tsx`
- Add: `frontend/src/pages/Dashboard/__tests__/sankey.test.ts` (+ section test)
- Edit: `frontend/src/pages/Dashboard/index.tsx` (render the section)

No backend, schema, or migration changes.
