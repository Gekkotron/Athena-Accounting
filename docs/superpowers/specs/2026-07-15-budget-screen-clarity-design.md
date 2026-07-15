# Budget screen clarity pass — design

**Date:** 2026-07-15
**Status:** approved, ready for plan
**Scope:** presentation-only rewrite of `SummaryCard` and `BudgetRow`; no
backend, API, or business-logic changes.

## Problem

The current Budget screen is technically correct but hard to *read*. In
one conversation the user flagged all four of:

1. **Too many numbers per row** — each `BudgetRow` shows spent, limit,
   projected, average, %, and remaining, all at similar visual weight.
2. **Weak hierarchy & dense layout** — title, `SummaryCard`, rows,
   suggestions, and unbudgeted all feel like the same visual weight.
3. **Sparklines & status colors unclear** — the 7-bar mini chart in the
   summary and the per-row sparkline don't obviously communicate trend;
   sage/amber/clay signal isn't loud enough.
4. **Labels & wording confusing** — `Projection`, `~`, `avg`,
   `Dépassement projeté`, `● anomalie` aren't immediately obvious.

## Goal

A user glancing at the screen for two seconds should be able to answer:
"Am I OK this month? By how much?" Everything else is secondary.

## Non-goals

- No grouping rows by status (deferred approach B).
- No progressive disclosure / expand-on-click (deferred approach C).
- No changes to `SuggestionCard`, `UnbudgetedSection`, `AddBudgetForm`,
  `PeriodSelector`, `AccountFilter`.
- No changes to the API, `useBudgets`, `budget-math.ts`, or the DB.

## Design

### `SummaryCard` — hero, not dashboard

Replace the 3-row/mini-chart layout with a bold hero + one contextual
status line.

Hero (single sentence, primary weight):

    Vous avez dépensé €2 340 sur €3 000 ce mois-ci.

- The spent amount is bold/xl; the rest of the sentence is regular
  weight in `text-ink-200`.
- For yearly period, replace `ce mois-ci` with `cette année`.
- `formatAmount` still handles currency and French decimals.

Status line beneath the hero (one line, medium weight, colored):

- **On track** (`pace === 'onTrack'`, or no projection but under limit):
  `Il reste €X d'ici la fin du mois.` (sage-300)
  For yearly: `d'ici la fin de l'année`.
- **Slipping** (`pace === 'over'` with projection > limit but current
  spent still <= limit):
  `À ce rythme, vous dépasserez de €X.` (amber-300)
- **Over** (current spent > limit, i.e. `totals.remaining < 0`):
  `Vous avez dépassé de €X.` (clay-300)

The status branch is derived from `totals` (`limit`, `spent`,
`remaining`, `projected`) with no new backend field. `summarizePace` is
reused; a small helper resolves the three copy variants + colors from
the pace + sign of `remaining`.

Removed from `SummaryCard`:

- The 7-bar mini chart (`summedHistory` + `<svg>`). It was the "cryptic"
  visual and it duplicates information already carried by the per-row
  sparklines (which are also being dropped — see below).
- The explicit `Projection ~€X · Dépassement projeté` row.
- The explicit `Reste €X` row.
- The `bg-amber-900/20 / bg-sage-900/20 / bg-ink-900/40` full-card tint.
  The card stays neutral; color lives on the status line only. This keeps
  the hero from competing with the row list for attention.

### `BudgetRow` — one primary line, one muted secondary

Three-row block, in this order:

1. **Primary line** (bold, base size):
   - Left: category `name`.
   - Right: status text, colored by state. Precedence, top to bottom
     (first match wins):
     - `r.limit === 0` (draft / just-deleted edge case): `€X dépensés`
       (ink-300) — no status color, no "sur €Y".
     - `r.over === true` (i.e. `spent > limit`): `Dépassé de €X`
       (clay-300).
     - `paceState(r) === 'over'` (projected exceeds limit but we're
       not over yet): `€X restants · à surveiller` (amber-300).
     - otherwise (on track): `Reste €X sur €Y` (sage-300,
       `tabular-nums`).

2. **Progress bar**: `h-2 rounded-full bg-ink-800 overflow-hidden` with
   an inner `<div>` sized to `pct` and colored by `barColor(pct, over)`
   (function kept from current file). **No `% overlay`.** The bar itself
   carries the signal; the number was redundant.

3. **Secondary line** (muted, `text-xs text-ink-500`, flex justify-between):
   - Left: trend clause. Built from projected + history.average:
     - both present: `À ce rythme €P · Habituellement €A`
     - only projected: `À ce rythme €P`
     - only average: `Habituellement €A`
     - neither: line hidden entirely (no trend to show).
     - `r.anomaly === true` appends ` · inhabituel` at the end of the
       trend clause (same muted color, no dot glyph).
   - Right: action buttons `Modifier` / `Supprimer` when `budgetId` is
     defined; edit-mode input + `OK` / `Annuler` when `editing`.
     Buttons stay `btn-ghost !py-1 !px-2 text-xs` — same size as today
     but demoted from their own row into the muted line.

**Sparkline dropped** — `Sparkline.tsx` is removed once no consumer
imports it. The words in the secondary line ("À ce rythme · Habituellement")
convey the same story more clearly.

### Copy dictionary

Applied everywhere in `SummaryCard.tsx` and `BudgetRow.tsx`:

| Before                       | After                                    |
|------------------------------|------------------------------------------|
| `Projection`                 | (removed as a label — folded into copy)  |
| `~€X`                        | `À ce rythme €X`                         |
| `Dépassement projeté`        | `va dépasser de €X`                      |
| `avg €X`                     | `Habituellement €X`                      |
| `● anomalie`                 | `· inhabituel` (no dot, inline in muted line) |
| `Ce mois-ci` (label)         | (folded into hero sentence)              |
| `Reste` (label)              | kept in row status: `Reste €X sur €Y`    |

## File-level impact

- `frontend/src/pages/Budgets/SummaryCard.tsx` — full render rewrite;
  drop `summedHistory`, drop the `<svg>` block, drop background tint;
  add hero + status-line helper.
- `frontend/src/pages/Budgets/BudgetRow.tsx` — full render rewrite;
  keep `barColor`, `normalizeLimit`, `paceState`; drop `% overlay`
  span; drop `<Sparkline>`; remove the anomaly pill *element* (the
  anomaly signal itself is preserved — it becomes ` · inhabituel`
  appended to the muted trend clause); move buttons into the
  secondary line; rewrite the "Reste / Dépassé de" branch to the
  new 4-branch status text described above.
- `frontend/src/pages/Budgets/Sparkline.tsx` — delete (unused after
  this change).
- `frontend/src/pages/Budgets/index.tsx` — no changes.
- `frontend/src/pages/Budgets/budget-math.ts` — no changes.
- `frontend/src/pages/__tests__/Budgets.test.tsx` — update assertions
  for new copy.
- `frontend/src/pages/Budgets/__tests__/BudgetRow.test.tsx` — update
  assertions (drop `% overlay`, drop sparkline queries, update status
  copy).
- Any `SummaryCard` tests, if present — update or add if missing.

## Testing

- Every new or updated assertion targets user-visible text (`Reste €X
  sur €Y`, `Dépassé de €X`, `Il reste €X`, `Habituellement €X`, etc.)
  or `getByRole('progressbar')` semantics, not internal class names.
- `budget-math.ts` unit tests are untouched — no math changed.
- Run `pnpm --filter frontend test` to confirm no unrelated breakage.
- Manual smoke: browse `/budgets` in `monthly` and `yearly` periods,
  with 0 budgets, 1 budget on-track, 1 slipping, 1 over, 1 anomaly.

## Risk

- Test suites in `Budgets/__tests__/` and `pages/__tests__/Budgets.test.tsx`
  reference the current copy; every affected assertion must be updated
  in the same commit as the render change.
- `Sparkline.tsx` deletion may break unrelated imports if any exist —
  a grep is part of the plan.
- No production data risk: presentation-only, no migration, no API
  contract change.
