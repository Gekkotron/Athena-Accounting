# Budgets — design spec

**Date:** 2026-07-08
**Status:** Approved (brainstorming), pending implementation plan

## Goal

Add a **Budgets** screen that lets the user set a monthly spending limit per
expense category and see planned-vs-actual for a given month. The feature is
opt-in: the screen always exists in the sidebar, but only categories the user
has given a limit appear on it. No global on/off toggle.

Athena is a retrospective ledger (fed by bank statements after the fact), so
budgets are a light "am I over on this category this month?" signal, not a
forward-planning envelope system.

## Decisions (locked during brainstorming)

- **Model:** monthly limit per category. No rollover, no envelopes.
- **Over time:** one recurring limit per category, applied to every month.
  Editing a limit changes the comparison for all months (no per-month history).
- **Currency:** single currency per budget, default `EUR`. Actuals reuse the
  existing `/api/reports/categories` summation, which already sums `amount`
  across accounts without splitting by currency (a pre-existing simplification
  that is correct for an all-EUR household). No new multi-currency machinery.
- **Which categories:** expense-kind categories only. Income/neutral are not
  offered in the "add budget" picker.
- **Optional:** the Budgets nav item is always present; the screen shows an
  empty state until at least one limit is set. Optionality = you simply don't
  set limits on categories you don't care about.
- **Compute approach (A):** the planned-vs-actual join is done server-side in
  SQL via a dedicated report endpoint; the page is a thin renderer.

## Data model

New table `category_budgets` (migration `0015`):

| column          | type          | notes                                   |
|-----------------|---------------|-----------------------------------------|
| `id`            | serial PK     |                                         |
| `user_id`       | int NOT NULL  | FK `users(id)` ON DELETE CASCADE        |
| `category_id`   | int NOT NULL  | FK `categories(id)` ON DELETE CASCADE   |
| `monthly_limit` | numeric(14,2) | > 0, enforced by CHECK                   |
| `currency`      | varchar(3)    | NOT NULL DEFAULT `'EUR'`                 |
| `created_at`    | timestamptz   | DEFAULT now()                           |
| `updated_at`    | timestamptz   | DEFAULT now()                           |

- `UNIQUE (user_id, category_id)` — one recurring limit per category.
- Deleting a category cascades to its budget (FK).
- Drizzle: add to `schema.ts`; hand-written SQL migration `0015` mirrors it.

## API

All auth-protected. New resource + one report endpoint.

| Method | Path                              | Notes                                            |
|--------|-----------------------------------|--------------------------------------------------|
| GET    | `/api/budgets`                    | List the user's limits.                          |
| POST   | `/api/budgets`                    | `{categoryId, monthlyLimit, currency?}`. 409 if that category already has a budget. |
| PUT    | `/api/budgets/:id`                | `{monthlyLimit, currency?}`. Update.             |
| DELETE | `/api/budgets/:id`                | Remove a limit.                                  |
| GET    | `/api/reports/budget?month=YYYY-MM` | The join. Defaults to the current calendar month. |

### `/api/reports/budget` response

Returns one row **per budgeted category** (categories without a limit are
excluded):

```json
{
  "month": "2026-07",
  "currency": "EUR",
  "rows": [
    {
      "categoryId": 12,
      "name": "Restaurants",
      "color": "#...",
      "limit": "300.00",
      "spent": "240.00",
      "remaining": "60.00",
      "pct": 80,
      "over": false
    }
  ],
  "totals": { "limit": "...", "spent": "..." }
}
```

- `spent` is the month's outflow as a **positive** number. Expense amounts are
  stored negative, so `spent = -SUM(amount)` for the category that month.
- Reuses the `tx_effective` CTE from `/api/reports/categories` so splits are
  counted per split-category and internal transfers (`transfer_group_id IS NOT
  NULL`) are excluded.
- A budgeted category with no spend that month returns `spent: "0.00"`.
- `pct = round(spent / limit * 100)`; `over = spent > limit`.

### Validation / errors

- Duplicate category on POST → **409**.
- `monthly_limit` ≤ 0 or non-numeric → **400**.
- `categoryId` not owned by the user, or not `kind = 'expense'` → **400**.
- `month` not matching `YYYY-MM` → **400**.
- All queries scoped by `user_id` (ownership isolation), like every other route.

## UI

New `frontend/src/pages/Budgets/` page, route `/budgets`, added to the sidebar
`nav` list in `Layout.tsx` (`{ to: '/budgets', label: 'Budgets', icon:
'budgets' }`, placed after *Catégories*). Add a `budgets` icon to the
`NavIcon` component.

Screen contents:

- **Month picker** — defaults to the current month; prev/next navigation.
- **Summary header** — total budgeted vs total spent this month.
- **One row per budgeted category** — colored category name, a progress bar
  (green < 80%, amber 80–100%, red > 100% — amber matches the app's existing
  drift convention), `spent / limit`, and "reste X €" or "dépassé de X €".
- **Ajouter un budget** — a picker of expense categories that don't yet have a
  budget + a limit input. Inline edit of the limit and a delete action on each
  row.
- **Empty state** — when no budgets exist: a short explainer and the add button.
- **Privacy blur** — amounts respect the existing `PrivacyContext` blur, like
  the rest of the app.

Data fetching via TanStack Query hooks (`useBudgets`, `useBudgetReport(month)`),
mirroring existing page patterns. Mutations invalidate both queries.

## Backup

Add `category_budgets` to the backup export/import payload
(`backup/export.ts` + `backup/restore.ts`) as an **optional** array. Following
the codebase's additive precedent (checkpoints, splits, fileImports were all
added this way), the payload `VERSION` stays `2` — old backups without the field
still validate. Because restore remaps entities by **name**, each exported
budget references its category by name (not raw id); restore resolves it back to
the new category id, skipping any budget whose category didn't restore.

## Testing

**Backend** (under the existing `RUN_DB_TESTS` gate):

- CRUD: create, list, update, delete.
- Duplicate-category guard → 409.
- Validation: non-positive/non-numeric limit → 400; non-expense category → 400;
  foreign category → 400; bad `month` → 400.
- User isolation: user A cannot see or mutate user B's budgets.
- Budget report: month filter; split-aware `spent`; internal transfers excluded;
  over/under math (`pct`, `over`, `remaining`); budgeted category with zero spend
  returns `spent: 0`.
- Backup round-trip: a budget survives export → restore and re-links by category
  name.

**Frontend** (Vitest + Testing Library):

- Renders rows with correct bar color thresholds and "reste / dépassé" text.
- Empty state when no budgets.
- Add / edit / delete flows call the right mutations and invalidate.
- Privacy blur hides amounts when active.

## Out of scope (explicitly)

- Rollover / envelope budgeting (possible later; the table can gain an
  `effective_from` column without a rewrite if per-month history is ever wanted).
- Budgets on income or neutral categories.
- Multi-currency conversion (waits on the separately-planned manual FX table).
- Email/alert notifications on overspend (a separate TODO item).
