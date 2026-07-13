# Budgets v2 — richer targets, monthly + yearly, contextual signals

**Status:** design approved, ready for implementation plan
**Date:** 2026-07-13
**Author:** Gekkotron

## Problem

The current Budgets page is a passive report: it shows a monthly cap per category and paints the bar red once you exceed it. That answers "did I overspend?" but not "how badly, why, and what should I do?" — the value question the user raised.

Two complaints to address:

1. **Purpose is unclear.** Setting a 50 € limit and seeing 150 € spent as a red bar is a post-hoc verdict, not a tool that helps you avoid or understand the overspend.
2. **The page is visually plain.** Flat rows, no hierarchy, no summary, minimal delight.

## Goal

Evolve the existing Budgets feature into an **ezBookkeeping-style spending-target tracker** with:

- **Monthly and yearly** periods
- **Optional per-account scope**
- **Contextual signals** on every row (pace projection, historical baseline, anomaly badge, suggested new limit)
- **Summary card** at the top with a period roll-up (spent / limit / remaining / projection)
- Visual polish that matches the rest of the app

Envelope-style zero-based budgeting (Actual Budget) is explicitly **out of scope** — that will be a separate menu entry ("Envelopes") in a future spec.

## Non-goals

- Envelope / rollover / "move money between budgets" mechanic — separate future feature
- Push / email notifications
- Custom date ranges beyond monthly + yearly
- Multi-currency conversion (existing same-currency roll-up preserved)
- Shared / household budgets

---

## Data model

Two schema changes to `category_budgets`:

1. **`period` enum** — `'monthly' | 'yearly'`, `NOT NULL DEFAULT 'monthly'`. Existing rows keep working (all become monthly).
2. **`account_id int NULL REFERENCES accounts(id) ON DELETE CASCADE`** — `NULL` = global (all accounts). Non-null = only counts transactions from that account.

**Unique constraint change.** Today's unique key is `(user_id, category_id)`. We need one row per `(user_id, category_id, account_id, period)`, but Postgres treats `NULL` as distinct in a regular unique index, which would let a user create unlimited "global monthly Restaurants" rows. Solution: two partial unique indexes:

- `UNIQUE (user_id, category_id, period) WHERE account_id IS NULL` — one global budget per category+period
- `UNIQUE (user_id, category_id, period, account_id) WHERE account_id IS NOT NULL` — one per account+category+period

**No new tables.** Pace, historical baseline, anomaly detection, and suggested-limit are computed on read from `transactions` and `category_budgets` — nothing persisted.

**Migration.** One drizzle migration:

```sql
ALTER TABLE category_budgets
  ADD COLUMN period text NOT NULL DEFAULT 'monthly'
    CHECK (period IN ('monthly','yearly')),
  ADD COLUMN account_id integer REFERENCES accounts(id) ON DELETE CASCADE;

-- Existing uniqueness is a unique index, not a table constraint.
DROP INDEX category_budgets_user_category_idx;

CREATE UNIQUE INDEX category_budgets_global_uniq
  ON category_budgets (user_id, category_id, period)
  WHERE account_id IS NULL;

CREATE UNIQUE INDEX category_budgets_scoped_uniq
  ON category_budgets (user_id, category_id, period, account_id)
  WHERE account_id IS NOT NULL;
```

Backfill is trivial (defaults handle it). Old backup dumps import cleanly since both new columns are nullable/defaulted.

---

## API contract

### `GET /api/reports/budget` — extended

**Query params:**

- `period`: `'monthly' | 'yearly'` — default `monthly`
- `month`: `YYYY-MM` — required when `period=monthly`
- `year`: `YYYY` — required when `period=yearly`
- `accountId`: optional integer — filters spend to that account and hides budgets scoped to other accounts

**Response shape:**

```jsonc
{
  "period": "monthly",
  "month": "2026-07",              // or "year": "2026" for yearly
  "windowDays": 31,
  "elapsedDays": 13,
  "rows": [
    {
      "categoryId": 42,
      "name": "Restaurants",
      "color": "#…",
      "accountId": null,           // null = global, else scoped account id
      "period": "monthly",
      "limit": "50.00",
      "currency": "EUR",
      "spent": "38.20",
      "remaining": "11.80",
      "pct": 76,
      "over": false,
      "projected": "91.10",        // spent / elapsedDays * windowDays
      "history": {                 // last 6 completed periods, oldest first
        "values": ["42.15", "51.30", "48.90", "55.10", "39.80", "62.25"],
        "average": "49.92",
        "median": "50.10"
      },
      "anomaly": true,             // |spent − avg| > 1σ of last 6 periods
      "suggestedLimit": "62.00"    // present when chronically over/under
    }
  ],
  "totals": {
    "limit":     "450.00",
    "spent":     "312.40",
    "remaining": "137.60",
    "projected": "685.20"
  }
}
```

**Field-by-field rules:**

- `projected` — `null` when `elapsedDays < 3` (too early for a meaningful projection); equals `spent` for past periods.
- `history.values` — length ≤ 6, oldest first, `null` when < 2 completed periods available; missing months are `"0.00"` (empty periods count).
- `anomaly` — `false` unless ≥ 3 completed periods of history AND `|spent − avg| > σ`.
- `suggestedLimit` — populated when EITHER (chronic over: ≥ 3 of last 6 periods spent > limit → suggest the 6-period median) OR (chronic under: ≥ 3 of last 6 spent < 50 % of limit → suggest the 6-period median). Otherwise absent.

### `POST /api/budgets` / `PUT /api/budgets/:id`

Body extended with two optional fields:

```jsonc
{
  "categoryId": 42,
  "monthlyLimit": "50.00",
  "currency": "EUR",
  "period": "monthly",             // default 'monthly'
  "accountId": null                // null | int; server-verified ownership
}
```

Server validations:

- `period ∈ {'monthly','yearly'}`
- If `accountId` given → account belongs to user
- Unique-violation `23505` → `409 budget_exists` with echo `{categoryId, period, accountId}`

### `GET /api/budgets`

Unchanged shape, adds `period` and `accountId` to each item.

### Naming note

The JSON key `monthlyLimit` becomes semantically **"period target"** (still a decimal string). We keep the key name for backup/restore compatibility and to avoid a wide frontend rename. A comment in the schema explains this. Internally we still call it a "target" in prose.

---

## Page structure & UI

### Shell

```
┌─────────────────────────────────────────────────────────────┐
│  Budgets                       [Mois] [Année]  ‹ 2026-07 ›     │
│  Plafond par catégorie de dépense.                              │
├─────────────────────────────────────────────────────────────┤
│  ┌ Summary card ──────────────────────────────────────┐        │
│  │  Ce mois-ci     312,40 €  /  450,00 €              │        │
│  │  Projection    ~685,20 €       ▁▂▃▅▇▆              │        │
│  │  Reste          137,60 €  ·  Dépassement projeté   │        │
│  └────────────────────────────────────────────────────┘        │
├─────────────────────────────────────────────────────────────┤
│  Compte : [Tous ▾]                                             │
│                                                                │
│  Alimentation                                                  │  ← group header (root with no own budget)
│    Restaurants                    38,20 € / 50,00 €    ● anomalie
│    ▃▂▄▃▅▇▆    ~91,10 €  · avg 49,92 €    [Modifier]         │
│    ────────────────────────────────  76%  ────────────         │
│                                                                │
│    Courses                       210,45 € / 250,00 €           │
│    ▄▄▅▅▆▄    ~415 € (dépassera)                              │
│    ──────────────────────────  84%  ────────                   │
│                                                                │
│  ┌ Suggestion ────────────────────────────────────────┐        │
│  │  Restaurants dépasse depuis 3 mois. Passer à 62 €? │        │
│  │  [ Ignorer ]  [ Ajuster à 62,00 € ]                │        │
│  └────────────────────────────────────────────────────┘        │
│                                                                │
│  Catégories sans budget (2)                                    │
│    Loisirs (avg 84 €/mois)     [Définir un plafond]           │
│    Transport (avg 120 €/mois)  [Définir un plafond]           │
│                                                                │
│  [+ Ajouter un budget]                                         │
└─────────────────────────────────────────────────────────────┘
```

### Component inventory

- **`Budgets/index.tsx`** — page shell; owns period + month/year + accountId URL state; assembles child components.
- **`Budgets/PeriodSelector.tsx`** — `Mois` / `Année` toggle + navigator (`‹ ›`).
- **`Budgets/SummaryCard.tsx`** — top card: totals + projection + a **6-period totals mini bar chart** (summed row-by-row from `history.values`, current period highlighted). Amber background when `totals.projected > totals.limit`, sage otherwise. No per-day data is fetched — the mini chart reuses the same 6 history points every row already carries.
- **`Budgets/AccountFilter.tsx`** — chip dropdown; `Tous` = no `accountId` param; specific account = passes it to the report query.
- **`Budgets/BudgetRow.tsx`** — reworked from today's `BudgetLine`. Layout: name + amount + anomaly chip on line 1; sparkline (6-slot) + pace/avg summary + `Modifier` on line 2; progress bar with % overlay on line 3; over/under text below.
- **`Budgets/Sparkline.tsx`** — minimalist 6-bar SVG; current-period bar highlighted (sage/amber/clay); hover tooltip shows month + amount.
- **`Budgets/SuggestionCard.tsx`** — inline card rendered after a row with `suggestedLimit`. `Ignorer` / `Ajuster à X €` buttons.
- **`Budgets/UnbudgetedSection.tsx`** — collapsible list of expense categories with ≥ 3 completed months of non-zero spend and no active budget; each item has `[Définir un plafond]` that opens the add form pre-filled.
- **`Budgets/AddBudgetForm.tsx`** — extracted from today's inline block. Adds period radio + account select. Limit input placeholder shows `≈ X €/…` from the selected category's average.

### Client-side math (`Budgets/budget-math.ts`)

Pure functions unit-tested in isolation:

- `projectSpend({ spent, elapsedDays, windowDays })` — returns `null` if `elapsedDays < 3`, else `spent / elapsedDays * windowDays`.
- `mean(values)`, `median(values)`, `stdev(values)` — decimal-safe (input strings, output number).
- `detectAnomaly({ spent, history })` — `false` if `history.length < 3`, else `Math.abs(spent - mean(history)) > stdev(history)`.
- `suggestLimit({ limit, history })` — returns median when chronic over/under, else `null`.
- `normalizeSparkline(values, currentSpent)` — array of `{ height: 0..1, isCurrent: boolean }`.

Backend also computes and returns the derived fields (`projected`, `anomaly`, `suggestedLimit`) so both surfaces agree. Client math exists mostly for the pace curve inside the summary card, where the raw daily-cumulative data lives client-side.

### Yearly view specifics

- Same layout, but each row's sparkline shows **12 months of the year in progress** (past = actual, future = grey placeholder).
- `elapsedDays` still passed by server; pace = `spent / elapsedDays * windowDays` where `windowDays = 365` (or 366).
- Summary card shows year totals + projected end-of-year.

### Empty state (no budgets defined)

> *Aucun budget défini. Basé sur vos 3 derniers mois, nous pouvons vous proposer un point de départ.*
> `[ Voir les suggestions ]`

Button scrolls to the Unbudgeted section (which shows top-spending unbudgeted categories with a one-click `Définir un plafond`).

### Visual polish deltas

- **Card visual hierarchy.** Bigger title, more breathing room, less "row of small text" density than today.
- **Progress bar.** Same colors (`sage-500` / `amber-500` / `clay-500`), taller (10 px vs 8 px), with the % label rendered *inside* the bar when the fill is ≥ 30 % (right-aligned, tabular-nums, ink-950 text), else outside on the right.
- **Sparklines.** Bars in `ink-500`, current-period bar highlighted in the row's state color. No axes, no labels, hover tooltip shows `Juin 2026 · 42,15 €`.
- **Anomaly + suggestion chips.** New visual token — small pill with `●` prefix, low-key colors, not attention-grabbing.
- **Summary card** replaces today's one-line total. Same `surface` component, richer content.

---

## Interactions

**Period toggle (Mois ↔ Année).** Client-side only; swaps query params and navigator shape. State in URL (`?period=year&year=2026` vs `?period=month&month=2026-07`), refresh-safe. Account filter persists across period switch.

**Month/year navigator.** `‹ ›` buttons. Clamped so we don't navigate before the earliest transaction. Forward beyond current period is allowed (users may check next month's plan).

**Account filter chip.** `Tous ▾` dropdown; when set, rows filtered to `accountId = selected OR NULL`; global rows recompute their spent against only that account's transactions (server-side). URL param persisted (`?account=…`).

**Row inline edit.** Same UX as today. Extended: hint text `Suggéré : 62 € (médiane 6 mois)` under the input, click to pre-fill.

**Suggestion card.**

- `Ignorer` writes to `localStorage['budget-suggestions-dismissed-<period-key>'] = [categoryId, …]` — key is `2026-07` for monthly, `2026` for yearly. Card disappears; reappears next period if still chronic.
- `Ajuster à X €` fires PUT with new limit, optimistic update, suggestion clears.

**Unbudgeted section.** Collapsed by default. Header shows count: `Catégories sans budget (4)`. Content is scoped to the current view's period: on monthly view it lists expense categories with ≥ 3 months of non-zero spend and no *monthly* budget; on yearly view it lists categories with no *yearly* budget for the selected year. Each item's `[Définir un plafond]` scrolls to and opens the add-budget form pre-filled with the category + suggested limit (median of last 3 months) + the current view's period pre-selected.

**Add-budget form.** Adds:

- Period radio: `Mensuel` / `Annuel`
- Account selector: `Tous les comptes` (= NULL) / one option per user account
- Limit placeholder: `≈ 84 €/mois` (or `€/an`) based on selected category + period, sourced from category history

---

## Edge cases

1. **New user, no history.** All contextual signals degrade gracefully: no sparklines (skip column), `history.average = null`, no anomaly badges, no suggestions. Unbudgeted section only shows categories with ≥ 3 completed months of non-zero spend, so it stays empty too.

2. **Category deleted while budget exists.** Existing FK cascade handles it.

3. **Account deleted while a scoped budget exists.** `ON DELETE CASCADE` on the new `account_id` FK — deleting an account removes only budgets scoped to it; global budgets survive.

4. **Yearly + monthly budget for same category.** Both coexist (partial unique indexes enforce uniqueness within a period). They render in different views. Server totals are per-view — no cross-period rollup.

5. **Suggested limit for chronically under-budget category.** Symmetric to over-budget: same UI card, different verb. `Ajuster à 25 €` lowers the target to the 6-month median.

6. **Very early in the period.** Day 1–2 projection would explode (40 € × 30 = 1200 €). Skip projection when `elapsedDays < 3` — display `—` instead.

7. **Anomaly with < 6 months of history.** Requires ≥ 3 completed periods; below that, σ is meaningless and the badge is skipped.

8. **Currency mismatch.** Existing per-budget `currency` field retained. Summary card sums same-currency rows only; mixed-currency users see one summary line per currency. In practice the codebase treats EUR as the norm.

9. **Backup/restore compatibility.** Migration adds two nullable/defaulted columns → old dumps import cleanly. New backups include the two fields. `backend/src/http/routes/backup/schema.ts` needs the fields added to the exported schema.

10. **Race on unique-constraint violation.** POST already handles `23505` → `409 budget_exists`. Extended payload echoes `{categoryId, period, accountId}` so the frontend can render a precise error.

---

## Testing plan

### Backend

**`backend/tests/budgets-route.test.ts` — extend existing suite.**

- Table has `period` and `account_id` columns after migration; both partial unique indexes exist.
- POST /api/budgets:
  - Creates monthly + yearly budget for same category → both succeed
  - Two global monthly budgets for same category → 2nd = 409 `budget_exists`
  - Global + account-scoped budget for same category+period → both succeed
  - Two account-scoped budgets on same account+category+period → 2nd = 409
  - `accountId` referencing another user's account → 400
  - Invalid `period` value → 400
- PUT /api/budgets/:id updating `period` from monthly to yearly on a row where a yearly already exists → 409
- DELETE cascade — deleting an account cascades only account-scoped budgets, global ones intact
- GET /api/budgets — response items include `period` and `accountId`

**`backend/tests/reports-route.test.ts` — extend existing suite.**

- `/api/reports/budget?period=monthly&month=…` — regression guard on today's behavior
- `/api/reports/budget?period=yearly&year=…` — sums 12 months, groups yearly budgets
- `accountId` filter — spend rescoped, wrongly-scoped budgets hidden, global budgets kept
- New response fields:
  - `windowDays` / `elapsedDays` correct for monthly + yearly, past / current / future periods
  - `projected` null when `elapsedDays < 3`; equals `spent` for past periods
  - `history.values` / `average` / `median` populated with fixture data (6 completed periods)
  - `history.*` null when < 2 completed periods
  - `anomaly` true when spent deviates > 1σ, false otherwise, absent when < 3 periods
  - `suggestedLimit` populated when ≥ 3 of 6 overspent → median; symmetric under-spend case
- Multi-currency roll-up: mixed currencies produce grouped totals

### Frontend

**`frontend/src/pages/Budgets/__tests__/index.test.tsx` — extend existing suite.**

- Period toggle updates query params + navigator + summary
- URL state (`?period=year&year=2026`) restores on mount
- Account filter changes query param + hides / rescopes rows
- Summary card renders when at least one budget exists; hides when none
- Row rendering:
  - Sparkline present when `history.values` present, skipped when null
  - Pace text `~X €` when projection defined, `—` when < 3 days elapsed
  - Anomaly chip when `anomaly === true`
  - Suggestion card inline after row when `suggestedLimit` present
- Suggestion actions:
  - `Ignorer` writes localStorage, card disappears, no reappear on refresh in same period
  - `Ajuster à X €` fires PUT, optimistic update, suggestion clears
- Unbudgeted section collapsed by default; expanding shows entries; `Définir un plafond` opens pre-filled form
- Add-budget form:
  - Period radio + account select present
  - Placeholder shows `≈ X €/mois` when category selected, updates on change
  - Yearly submission fires POST with `period: 'yearly'`
- Empty state renders actionable text + jump-to-suggestions button
- Inline edit hint `Suggéré : X €` shown, pre-fills on click

**New file: `frontend/src/pages/Budgets/__tests__/budget-math.test.ts`** — pure-function tests for `projectSpend`, `mean` / `median` / `stdev`, `detectAnomaly`, `suggestLimit`, `normalizeSparkline`.

### Regression / behavioral guards

- Existing budget tests still pass with `period` defaulting to `monthly` and `accountId` defaulting to `null` — migration compatibility contract
- Backup/restore round-trip: export → import → all budget rows survive with correct `period` and `accountId`

---

## Rollout

- Single PR (worktree on `main`, per project convention).
- Migration is additive and defaulted — no downtime, no manual data steps.
- No feature flag; feature is a straight replacement of the current Budgets page.
- README / TODO updated to mark Budgets v2 done and flag Envelopes as the follow-up spec.
