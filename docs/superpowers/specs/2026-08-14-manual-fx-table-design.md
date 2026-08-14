# Manual FX table for multi-currency — design

**Status:** approved, ready for implementation plan
**Date:** 2026-08-14

## Problem

Every Athena account carries its own ISO 4217 `currency` (default EUR). Today, every aggregate view — Dashboard balance, timeseries chart, budgets report, insights, sankey, category donut, stats — emits data grouped by currency, and the frontend renders N separate cards / lines when the user holds more than one currency. There is no way to see a single consolidated total.

The schema has anticipated this since day one (`backend/src/db/schema.ts:77`, comment on `accounts`: _"aggregates are reported per currency until an explicit FX-rate table is introduced"_). This spec introduces that table.

Rates are **manual**: no automatic FX API integration. The self-hosted, LAN-only deployment target and the "trust-first, no third-party phone-homes" positioning both push against a scheduled external fetch.

## Non-goals

- Automatic FX rate fetching from any external provider.
- Per-transaction currency override (a transaction inherits its account's currency; that stays true).
- Currency change on an existing account (schema stays as-is).
- Playwright end-to-end coverage — demo-mode reads/writes tests cover this feature end-to-end at lower cost.

## Decisions

Locked during brainstorming, listed here so downstream planning can reference them:

| # | Decision |
|---|---|
| D1 | Time-varying rates: `(from, to, effective_from, rate)` — one row per pair per effective date. Historical charts stay stable when rates are edited later. |
| D2 | Global `displayCurrency` preference in `user_settings.settings` (nullable) + a "show per-currency" toggle in the UI. Not per-view. |
| D3 | First-pass scope covers the endpoints that already emit `perCurrency`: **balance, timeseries, budget report**. Frontend-only aggregations (sankey, donut, stats, insights) get a separate follow-up spec — see "Deferred to follow-up" below. |
| D4 | Missing rate → consolidate what we can + inline warning strip listing unmapped currencies; the unmapped balances stay visible as fallback cards. Never silently treat missing as 1:1. |
| D5 | Settings UX: a table with add / edit / delete rows; smart suggestions from accounts in use. |
| D6 | Storage shape: direct pairs `(from, to)` — never normalized to a base currency. Reverse pairs are not auto-derived. |
| D7 | Conversion site: hybrid — SQL join for `timeseries` (per-bucket historical rate fits the CTE), TS service (`consolidate()`) for every other aggregate. Both funnel through one shared `resolveRate` helper. |

## Schema

Migration `0038_fx_rates.sql`.

```
fx_rates
  id             serial PK
  user_id        int NOT NULL REFERENCES users(id) ON DELETE CASCADE
  from_ccy       varchar(3) NOT NULL   -- ISO 4217, uppercase
  to_ccy         varchar(3) NOT NULL
  effective_from date       NOT NULL   -- inclusive
  rate           numeric(20, 10) NOT NULL   -- 1 from_ccy = rate to_ccy
  created_at     timestamptz NOT NULL DEFAULT now()

  UNIQUE (user_id, from_ccy, to_ccy, effective_from)
  CHECK  (from_ccy <> to_ccy)
  CHECK  (rate > 0)
  INDEX  (user_id, from_ccy, to_ccy, effective_from DESC)
```

Drizzle types in `backend/src/db/schema.ts` grow the matching `fxRates` table.

**Display-currency preference.** User settings live in the existing `user_settings.settings` JSONB, not a column on `users`. Add a new `displayCurrency` field to the Zod schema in `backend/src/domain/settings/schema.ts` (nullable ISO code, default `null` = per-currency mode) and to `backend/src/domain/settings/defaults.ts`. The existing `PATCH /api/settings` endpoint handles the write; no new route.

### Lookup rule

At date `T`, the effective rate for `(from, to)` is the row with the **largest `effective_from ≤ T`** for that pair. If none exists → the pair is unmapped at that date. The reverse pair (`to → from`) is **not** derived from a stored `(from, to)` row — the user enters what they intend to be visible.

### Backfill

None. The table starts empty; behavior with no rates + `displayCurrency = null` is identical to today, so this is a purely additive change.

## Shared FX helper

New module tree under `backend/src/domain/fx/`:

```
domain/fx/
  rates-repo.ts       -- loadUserRates(userId) → sorted rows
  resolve-rate.ts     -- resolveRate(rates, from, to, at) → number | null
  consolidate.ts      -- consolidate(perCurrency, display, rates, at, keys) → { display, unmapped, ...totals }
  __tests__/
    resolve-rate.test.ts
    consolidate.test.ts
```

### `resolveRate(rates, from, to, at)`

Pure function.

- `from === to` → returns `1`.
- Otherwise: picks the row with the largest `effective_from ≤ at` matching `(from, to)`.
- Returns `null` when no such row.
- Never falls back to `1` or to the reverse pair.

### `consolidate(perCurrency, display, rates, at, keys)`

Takes the shape existing aggregates already emit — `[{ currency, ...numericFields }]` — plus a resolution date and a list of numeric field names to convert. Returns:

```
{
  display: string,                       // display currency
  totals:  { [key in keys]: Decimal },   // sum of converted amounts per field
  unmapped: Array<{ currency, ...numericFields }>,
}
```

### Rate cache

One `loadUserRates(userId)` call per HTTP request; result memoized on the Fastify request object so multiple report endpoints share the fetch. No cross-request cache — a user's table is realistically < 100 rows.

## Backend routes

### CRUD: `/api/fx-rates`

```
GET    /api/fx-rates         → { rates: [{ id, from, to, effectiveFrom, rate }] }
POST   /api/fx-rates         body { from, to, effectiveFrom, rate } → 201 { rate }
PATCH  /api/fx-rates/:id     body { rate?, effectiveFrom? }
DELETE /api/fx-rates/:id     → 204
```

Zod validation:
- `from`, `to` are 3-letter uppercase ISO codes.
- `from !== to`.
- `rate > 0`, at most 10 decimals.
- `effectiveFrom` is a valid `YYYY-MM-DD`.

Unique-constraint violation on POST/PATCH → HTTP 409 with `{ code: 'DUPLICATE_RATE' }`.

Route lives under `backend/src/http/routes/fx-rates.ts`; registered in `buildServer.ts` next to the other settings-adjacent routes.

### Preference: display currency

No new endpoint. `PATCH /api/settings` already accepts a partial patch merged into `user_settings.settings`. Setting `displayCurrency: null` reverts to per-currency mode.

### Existing reports — response evolution

The three routes that already emit `perCurrency` — `/api/reports/balance`, `/api/reports/timeseries`, `/api/reports/budget` — each grow an optional `?display=<ccy>` query param (defaults to the `displayCurrency` field of the user's settings).

Response shape adds a `consolidated` block **alongside** the existing `perCurrency` — never in place of it:

```
GET /api/reports/balance?display=EUR →
{
  perCurrency: [ … unchanged … ],
  consolidated: {
    display:  "EUR",
    total:     "12345.67",
    available: "10000.00",
    invested:  "2345.67",
    unmapped:  [{ currency: "USD", total: "500.00", available: "500.00", invested: "0.00" }]
  } | null   // null when display is unset or query says display=none
}
```

The same envelope shape is added to `/api/reports/timeseries` and `/api/reports/budget`. `balance` and `budget` implement the block via `consolidate()`; `timeseries` does the JOIN in SQL (next section) because each bucket needs its own historical rate.

### Timeseries — in-SQL conversion

Every bucket needs its own historical rate for stability. The existing CTE already groups by `bucket`, so the join fits naturally. The final SQL tail becomes:

```sql
-- Assumes the existing CTE ends with:
--   final_series (account_id, currency, bucket, running_balance)

WITH rate_at_bucket AS (
  SELECT p.account_id, p.currency, p.bucket, p.running_balance,
         (
           SELECT r.rate
           FROM fx_rates r
           WHERE r.user_id      = $userId
             AND r.from_ccy     = p.currency
             AND r.to_ccy       = $displayCcy
             AND r.effective_from <= p.bucket
           ORDER BY r.effective_from DESC
           LIMIT 1
         ) AS rate
  FROM final_series p
)
SELECT bucket,
       $displayCcy AS currency,
       SUM(running_balance * rate) FILTER (WHERE rate IS NOT NULL OR currency = $displayCcy) AS total,
       COALESCE(
         jsonb_agg(DISTINCT currency) FILTER (
           WHERE rate IS NULL AND currency <> $displayCcy
         ),
         '[]'::jsonb
       ) AS unmapped
FROM rate_at_bucket
GROUP BY bucket
ORDER BY bucket;
```

The identity short-circuit (`currency = $displayCcy → rate = 1`) is handled in the outer `SUM`/`FILTER` clauses rather than in the correlated subquery, to keep the subquery readable.

Response wrapper for timeseries:

```
{
  perCurrency: [...],
  consolidated: {
    display: "EUR",
    points:  [{ bucket, total, unmapped: ["USD"] }],
  } | null
}
```

### Per-route wiring — TS side

| Route | Aggregation shape today | Wiring |
|---|---|---|
| `reports/balance` | `SELECT ... GROUP BY currency` | after fetch, `consolidate(rows, display, rates, today, ["total", "available", "invested"])` |
| `reports/budget` | `GROUP BY b.id, ..., b.currency` | same, `at = end of budget period` |

### Deferred to follow-up

The Dashboard's **sankey, category donut, category breakdown, and stat widgets** are pure frontend components: they aggregate raw transactions in `useMemo`, not from a dedicated per-currency backend endpoint. Making them FX-aware requires either (a) a new backend endpoint that emits per-transaction converted amounts, or (b) shipping the rate table to the frontend and doing the FX math in TS.

Neither option fits cleanly on top of the current architecture, and locking on one shape here risks doing the wrong thing. **Out of scope for this spec** — file a follow-up once the balance/timeseries/budget rollout is real and the right pattern is obvious. Until then, those components stay in the account's own currency (unchanged behavior); the Dashboard header consolidated card is what "goes multi-currency" in v1.

### Demo mode

`frontend/src/api/demo/handlers/writes/` gains `fx-rates.ts` (CRUD parity). `reads/` handlers grow the same `consolidated` block using an in-memory demo rates map. Demo experience stays feature-parity with the real backend.

## Frontend UX

### Settings — new "Multi-currency" section

Placed on `pages/Settings.tsx` below the existing preference blocks.

**Panel 1 — display currency.** A select with options: `{ currencies present in user's accounts } ∪ { EUR, USD, GBP }` plus a "None (per-currency)" option. Writes to `PUT /api/settings/display-currency` on change.

**Panel 2 — manual rates table.** Columns `From`, `To`, `Effective from`, `Rate`. Sorted by `(from, to, effective_from DESC)`. Header row is an inline add-row form:

- Two currency selects (same currency union as above).
- A date picker defaulting to today.
- A rate input — **text + `inputMode="decimal"` + `parseDecimal()` helper. Never `<input type="number">`.** (See memory: "French decimal inputs".)

Each existing row has edit-in-place + delete buttons. A server 409 duplicate error surfaces as a red inline error under the form.

**Smart suggestions.** When the user has accounts in a currency they haven't added a rate for yet, an unobtrusive helper strip above the table lists them: `"USD account detected — no rate to EUR yet [Add]"`. Click prefills the add-row form.

### Dashboard behavior

- **`display_currency` set, `consolidated` non-null:** the current `perCurrency` cards collapse to a single "Total" card in the display currency. A small chip below (`"Convertie depuis 3 devises · Ajuster"`) links to the Settings section.
- **`consolidated.unmapped` non-empty:** a subtle warning strip above the card lists un-consolidated currencies with an inline "Add rate" CTA. Each unmapped currency also keeps its per-currency card — the user never loses sight of raw amounts.
- **`display_currency` NULL:** current behavior, unchanged.

### Timeseries chart

When `consolidated` is present, the chart draws a single line in the display currency using `consolidated.points`. The legend gains a "Show raw per-currency" toggle that swaps back to the current multi-line view. Buckets whose `unmapped` list is non-empty render a dashed segment + a tooltip note.

### Budget report

The existing budget report reads `consolidated` when present and falls back to `perCurrency` otherwise. One prop on the existing component; no visual redesign.

Frontend sankey / donut / stats / breakdown components stay unchanged in v1 (see "Deferred to follow-up" in the backend section).

### i18n

New strings under `frontend/src/locales/{fr,en}.json` in `settings.fx` and `common.fx` namespaces (e.g. `settings.fx.title`, `common.fx.unmappedWarning`, `common.fx.convertedFrom`). French is drafted first; English is a translation of the French.

## Testing

- **Backend unit (`vitest`):**
  - `domain/fx/__tests__/resolve-rate.test.ts` — identity, exact-date, older-date, missing pair, `from = to` short-circuit, non-derivation of reverse pair.
  - `domain/fx/__tests__/consolidate.test.ts` — full coverage, partial (unmapped), empty rates, multi-key numeric conversion.
  - Route tests for `/api/fx-rates` CRUD: validation errors, uniqueness → 409, cascade on user delete.
- **Backend integration (skipped locally, run in CI via `RUN_DB_TESTS=1`):** balance + timeseries against a seeded `fx_rates` table; verifies stable historical values after inserting a newer `effective_from` row for the same pair.
- **Frontend unit (`vitest`):**
  - Settings section: add / edit / delete happy path, duplicate 409 rendering, French-decimals round-trip in the rate input.
  - Dashboard rendering: consolidated card, unmapped strip, no-display fallback.
- **Demo-mode tests:** parity for `fx-rates` CRUD + `consolidated` block in every read handler that grew one.
- **No Playwright e2e.** Demo-mode reads/writes cover the flow end-to-end at lower cost.

## File-level impact map

New:
- `backend/db/migrations/0038_fx_rates.sql`
- `backend/src/domain/fx/{rates-repo,resolve-rate,consolidate}.ts` + `__tests__/`
- `backend/src/http/routes/fx-rates.ts` + `__tests__/`
- `frontend/src/api/demo/handlers/writes/fx-rates.ts`
- `frontend/src/pages/Settings/FxSection/` (new folder for the section + its subcomponents)

Modified:
- `backend/src/db/schema.ts` — `fxRates` table; update the comment on `accounts` (line 77) to reference this table.
- `backend/src/domain/settings/schema.ts` + `defaults.ts` — grow `displayCurrency` (nullable ISO code, default null).
- `backend/src/buildServer.ts` — register `fx-rates` route.
- `backend/src/http/routes/reports/balance.ts` — add `consolidated` block via `consolidate()`.
- `backend/src/http/routes/reports/timeseries.ts` — add `consolidated` block via CTE JOIN.
- `backend/src/http/routes/reports/budget.ts` — add `consolidated` block via `consolidate()`.
- Frontend consumers of `perCurrency` (v1 scope): `pages/Dashboard/index.tsx`, `pages/Dashboard/useForecastProjection.ts`, `pages/Recurrent/ForecastTab.tsx`, `components/BalanceChart/` — read `consolidated` when present, fall back to `perCurrency` otherwise.
- `frontend/src/pages/Settings.tsx` — mount the new `FxSection`.
- `frontend/src/locales/{fr,en}.json` — new `settings.fx` and `common.fx` namespaces.

## Risks & open questions

- **Numeric precision.** `numeric(20, 10)` for rate + existing `numeric(14, 2)` for money → `numeric(34, 12)` intermediate, then quantize back to 2 decimals per display currency. Implementation must use `pg`'s numeric-safe path (existing helpers already do; verify no `parseFloat` shortcut sneaks in).
- **Timeseries `from = currency` correctness.** The correlated subquery returns `NULL` when `p.currency = $displayCcy`. The outer `FILTER` handles it — but be careful when adjusting: silently dropping a bucket because "the identity case wasn't handled" would be a hard-to-notice regression. The test suite must include a mixed-currency timeseries with the display currency as one of the account currencies.
- **Editing a rate later — history stability.** Editing an existing row (same `effective_from`) rewrites the past. Adding a new row with a later `effective_from` leaves the past intact. UI copy on the edit action should make the distinction obvious.
- **Public-safe commit hygiene.** No IPs, no hostnames, no real rate values in tests — use obviously-fake rates like `USD→EUR = 0.9` (see memory: "Public-safe commits").
