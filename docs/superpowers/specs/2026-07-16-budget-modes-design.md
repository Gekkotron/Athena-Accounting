# Budget modes: Plafonds & Enveloppes — design

**Date:** 2026-07-16
**Status:** approved, ready for plan
**Scope:** introduce a second budgeting mode ("Enveloppes", modelled on
Actual Budget's envelope method) alongside the existing spending-cap mode
("Plafonds"). Independent data, single nav hub, new report endpoint, new
Dashboard tile.

## Problem

Athena today ships one budgeting model: a **recurring monthly cap per
category**. The `category_budgets` table stores a single `monthly_limit`
per `(user, category, period, account_id?)`; there is no rollover, no
per-month history, no "money must have a job" invariant. Its purpose is
to warn the user when a category is trending over its ceiling.

This model works for users whose mental frame is *"how do I stay under
my ceilings?"*. It does not work for users whose frame is *"I earned €X
this month — where does every euro go, and how much is left in each
envelope after last month?"* — Actual Budget's envelope method.

We want both modes available concurrently, so a user can pick whichever
matches their thinking (or use both — a category can carry a cap and an
envelope allocation independently).

## Guiding principles

- **Full mode independence.** Envelope tables never JOIN with
  `category_budgets`. A category may carry a cap, an envelope, both, or
  neither. Neither mode reads the other's data.
- **No feature flag, no gradual rollout.** The app is LAN-only, single
  user; adding an envelope screen alongside the cap screen has no blast
  radius. Existing caps users see the new sub-nav entry, click it, and
  land on an empty state — zero data change.
- **Reuse existing category kinds.** Savings envelopes are just expense
  categories with an optional target — no new `kind`, no new taxonomy.
- **On-read computation.** Envelope balances and pool are computed from
  transactions + assignments on every report call. No cache table in
  v1; personal-finance data volumes don't warrant it.

## Nav shape

Convert the flat `{ to: '/budgets', label: 'Budgets' }` entry in
`frontend/src/components/Layout.tsx` into a hub with two children,
matching the existing `Règles` / `Comptes` / `Données` pattern:

```
Tous les jours
  Dashboard
  Transactions
  Budgets                        (hub, to=/budgets)
    Plafonds                     (/budgets/plafonds)
    Enveloppes                   (/budgets/enveloppes)
```

`/budgets` redirects to `/budgets/plafonds` for bookmark compatibility.
The current `pages/Budgets/Budgets.tsx` is renamed to `Plafonds.tsx`
without semantic change. The DB table `category_budgets` keeps its name
for backward compat; a schema comment clarifies that "budget" in that
context now means "spending cap" specifically.

## Data model

Three new tables, orthogonal to `category_budgets`.

### `envelope_assignments` — per-month allocation per category

```sql
CREATE TABLE envelope_assignments (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month        DATE    NOT NULL,               -- first day of the month
  amount       NUMERIC(14,2) NOT NULL,         -- may be negative
  currency     VARCHAR(3) NOT NULL DEFAULT 'EUR',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id, month),
  CHECK (EXTRACT(DAY FROM month) = 1)
);
CREATE INDEX envelope_assignments_user_month_idx
  ON envelope_assignments (user_id, month);
```

Amount may be negative (represents pulling money out of an envelope for
that month). Reallocation between two envelopes writes two rows in one
transaction; there is no separate delta table.

### `envelope_category_settings` — target + overspend policy

```sql
CREATE TABLE envelope_category_settings (
  user_id           INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category_id       INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  target_amount     NUMERIC(14,2),
  target_date       DATE,
  target_kind       TEXT CHECK (target_kind IN
                      ('save_by_date', 'monthly_recurring', 'save_up_to')),
  overspend_policy  TEXT NOT NULL DEFAULT 'rollover_negative'
                    CHECK (overspend_policy IN
                      ('rollover_negative', 'reallocate_manual')),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_id)
);
```

Row exists only when the user configures a target or overspend policy;
absence = default policy (`rollover_negative`) + no target.

### `envelope_month_holds` — "Hold for next month" buffer

```sql
CREATE TABLE envelope_month_holds (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month        DATE    NOT NULL,               -- month FROM which money is held
  amount       NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month),
  CHECK (EXTRACT(DAY FROM month) = 1)
);
```

A hold on month M deducts from M's pool and adds to M+1's pool.

### What does NOT change

- `category_budgets` schema.
- `categories.kind` values.
- Dashboard "budget pace" widget in `InsightsSection` — continues to read
  `/api/reports/budget` (caps).
- All existing routes, hooks, and tests unrelated to `/budgets/*`.

## Semantics

The math is small but sensitive. Locking it here so the API and UI can't
drift from each other.

### Balance under `rollover_negative` (default)

```
balance(cat, M) = Σ_{m ≤ M} assignment(cat, m) − Σ_{m ≤ M} spend(cat, m)
```

Negatives carry forward automatically — that is what "rollover" means.

### Balance under `reallocate_manual`

The negative is absorbed by the following month's pool; the envelope
restarts at 0 next month.

```
raw(cat, M)       = assignment(cat, M) − spend(cat, M) + carry(cat, M−1)
carry(cat, M)     = max(0, raw(cat, M))         -- shown next month
absorbed(cat, M)  = max(0, −raw(cat, M))        -- eaten by pool(M+1)
```

The envelope is never displayed as negative under this policy; the pool
shrinks instead, and the row shows an `⚠ absorbé` chip.

### Pool

```
pool(M) = income_cumul(M)
        − assignment_cumul(M)
        − hold(M)                        -- money held THIS month
        + hold(M − 1)                    -- money held LAST month releases NOW
        − Σ absorbed(cat, M − 1)         -- reallocate_manual overspend
```

`income_cumul(M)` = sum of transactions whose category has
`kind = 'income'` and whose `transactions.date` (a plain `DATE` in the
schema) falls in a month `≤ M`. The pool may go negative; it is
displayed red with no hard block, matching Actual.

### Spend / income scope

- **Spend counted:** transactions with a `category_id` set to an
  envelope-active expense category, in the month's bucket.
- **Income counted:** transactions whose category has `kind = 'income'`.
- **Uncategorised transactions:** excluded from all envelope math; a
  separate "Non catégorisé" counter surfaces on the page so the user
  knows to categorise them.
- **Starting bank balance:** not auto-seeded. Users wanting the pool to
  reflect existing savings add a starting-balance income transaction,
  the same convention Actual uses.

### Edge cases

| Case | Behaviour |
|------|-----------|
| Category deleted | `ON DELETE CASCADE` — assignments and settings go with it. |
| Transaction re-dated across months | Next report call reflects it; no invalidation needed. |
| Transaction changes category | Same — recompute on read. |
| No assignment, some spend | `balance = 0 − spend` → negative; policy applies. |
| Multi-currency | v1 assumes single currency per user (same as caps). |
| Timezones | `month` is a plain `DATE`; transactions bucketed by `date_trunc('month', transactions.date)` — `transactions.date` is already a `DATE` (see `0000_init.sql`), so no timezone conversion is involved. |
| Hold set to 0 | Row removed on `PUT` with amount = 0. |
| Hold larger than pool | Allowed; pool goes negative that month, hold still releases next month. |
| `reallocate_manual` overspend on negative pool | Overspend still absorbed; pool becomes more negative. No cascade to other envelopes. |

## API surface

Mounted at `/api/envelopes/*`. Mirrors `budgets.ts`: `app.requireAuth`
preHandler, Zod validation, PG error `23505` handling. All wire amounts
are decimal strings (like existing `positiveDecimal`); months are
`YYYY-MM`.

### Assignments

```
GET    /api/envelopes/assignments?month=YYYY-MM
       → { assignments: [{ id, categoryId, month, amount, currency }] }

PUT    /api/envelopes/assignments
       body: { categoryId, month: "YYYY-MM", amount, currency? }
       → upsert on (user, category, month). Amount may be negative.
       → 201 with { assignment }

DELETE /api/envelopes/assignments/:id
       → 204

POST   /api/envelopes/reallocate
       body: { fromCategoryId, toCategoryId, month, amount }
       → atomic tx: source −=, dest +=. 400 if from == to.
```

### Category settings

```
GET    /api/envelopes/categories
       → { settings: [{ categoryId, targetAmount?, targetDate?,
                        targetKind?, overspendPolicy }] }

PUT    /api/envelopes/categories/:categoryId
       body: { targetAmount?, targetDate?, targetKind?, overspendPolicy? }
       → upsert. Passing all fields null reverts to defaults.

DELETE /api/envelopes/categories/:categoryId
       → 204
```

Only expense categories accepted (`expenseCategoryOwned` guard, reused
from `budgets.ts`).

### Month holds

```
GET    /api/envelopes/holds?from=YYYY-MM&to=YYYY-MM
       → { holds: [{ month, amount }] }

PUT    /api/envelopes/holds
       body: { month: "YYYY-MM", amount }
       → 200 with { hold } — amount = 0 deletes the row and returns { deleted: true }.
```

### Report — the endpoint the Enveloppes page actually calls

```
GET /api/envelopes/report?month=YYYY-MM
```

Response — everything the page needs in one SQL pass:

```jsonc
{
  "month": "YYYY-MM",
  "pool": {
    "incomeCumulative":     "18400.00",
    "assignedCumulative":   "16900.00",
    "heldFromPriorMonths":  "500.00",
    "heldForNextMonth":     "0.00",
    "available":            "1240.00"
  },
  "rows": [
    {
      "categoryId": 42,
      "categoryName": "Alimentation",
      "balancePriorMonth": "80.00",
      "assignment":        "450.00",
      "spend":             "510.00",
      "balance":           "20.00",
      "target": {
        "amount": "500.00",
        "date": null,
        "kind": "monthly_recurring"
      },
      "overspendPolicy": "rollover_negative",
      "overspent": false,
      "absorbedByPool":  "0.00",
      "monthsToTarget": null
      // `absorbedByPool` is forward-looking: the amount this envelope
      // absorbed AT THE END OF the requested month, i.e. what will be
      // deducted from month M+1's pool. Always "0.00" under
      // `rollover_negative`.
    }
  ]
}
```

`balance` is derived server-side via a single CTE that folds
assignments and spend from the earliest assignment forward, returning
only the requested month's snapshot.

### Error taxonomy

- 400 `invalid input` (Zod), `category_not_expense`, `same_category` (reallocate).
- 404 `not found`.
- 409 none — assignments are upserts; no unique-collision race.

## UX — Enveloppes page

Follows existing patterns: dark theme (`surface`, `text-ink-*`), French
labels, `parseDecimal` for inputs (never `<input type="number">`),
`formatAmount` for display.

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  ‹  juillet 2026  ›                                     [Réglages ⚙] │
├──────────────────────────────────────────────────────────────────────┤
│  À budgétiser (pool)                                                 │
│                                                                      │
│   Disponible ce mois          €1 240,00     (red if negative)        │
│   Revenus (cumulé)  €18 400,00                                       │
│   Assigné (cumulé)  €16 900,00                                       │
│   Reçu du mois dernier   €500,00   (hold M−1 released)               │
│   Retenu pour le mois prochain    €0,00     [Retenir…]               │
│   Absorbé par le pool  −€260,00                                      │
├──────────────────────────────────────────────────────────────────────┤
│  ENVELOPPES                                                          │
│                                                                      │
│  Alimentation           Prev  Assign  Dépensé  Solde         ⋯       │
│    €80  [ 450,00 ]  €510,00  €20,00                                  │
│    ─── Objectif: 500€/mois ─────────────────────────                 │
│                                                                      │
│  Loyer                  €0     [ 950,00 ]  €950  €0,00       ⋯       │
│                                                                      │
│  Vacances 2026          €600   [ 100,00 ]  €0    €700,00     ⋯       │
│    ▓▓▓▓▓▓░░░░░░  700 / 1 200 · échéance déc. 2026                    │
│                                                                      │
│  Restaurants            €30    [   0,00 ]  €95   −€65,00 ⚠   ⋯       │
│    Sur-budget · politique: réaffectation manuelle                    │
│                                                                      │
│  + Ajouter une catégorie…                                            │
├──────────────────────────────────────────────────────────────────────┤
│  ▸ Non catégorisé ce mois (3 transactions, €142)                     │
└──────────────────────────────────────────────────────────────────────┘
```

### Row anatomy

- **Name** + optional progress bar for target categories.
- **Prev** — read-only carry from last month.
- **Assign** — inline text input (`inputMode="decimal"`, French comma),
  blur / Enter → `PUT /api/envelopes/assignments`. Optimistic update,
  invalidate on success.
- **Dépensé** — read-only spend for the month; click routes to the
  Transactions page pre-filtered by category × month.
- **Solde** — green ≥ 0, red < 0. Under `reallocate_manual`, shows
  `0,00` with a red `⚠ absorbé` chip; tooltip explains.
- **⋯** — row menu: *Réaffecter…* / *Objectif & politique…* /
  *Supprimer l'enveloppe*.

### Reallocation flow

Right-arrow icon → destination category picker (this month's envelopes
only) → amount input → confirm. Single `POST /api/envelopes/reallocate`
call, atomic. Reversible via a 5-second "Annuler" toast that fires the
mirror-image reallocate.

### Settings modal (per envelope)

- **Objectif** — kind: `Aucun` / `Économiser d'ici une date` /
  `Mensuel récurrent` / `Économiser jusqu'à`. Amount input. Optional date.
- **Politique de dépassement** — radio: `Report du solde négatif`
  (default) / `Réaffectation manuelle (absorbé par le pool)`.

### Progress bar rendering per target kind

- `save_by_date` — filled = balance / amount; deadline shown; overdue
  turns amber.
- `monthly_recurring` — filled = assignment / amount for this month.
- `save_up_to` — filled = balance / amount; no deadline.

### Empty & first-run states

- **No assignments, no settings anywhere** — CTA "Créer votre première
  enveloppe" using the same rolling-average suggestion source as
  `UnbudgetedSection`. One click seeds assignments for the current
  month.
- **Categories with spend but no envelope** — collapsible "Non
  budgétées" section (mirrors current `UnbudgetedSection`), each row →
  "Créer une enveloppe" opening the assign input inline.
- **Pool negative** — sticky red banner at the top of the page:
  *"Vous avez sur-budgété de €X. Réduisez des assignations ou ajoutez
  des revenus."*

### Month navigation

- Prev / next arrows step one month.
- Future months allowed (planning ahead is common). Deep-linkable:
  `/budgets/enveloppes?month=YYYY-MM`. Default = current month.

### Deliberately excluded from v1

- Drag-and-drop reallocation.
- Envelope groups / sub-category rendering in the layout (top-level
  filter, same as `topLevelRows` in `budget-math.ts`).
- Bulk "copy last month's assignments" endpoint + button.
- Multi-currency.
- Undo history beyond the 5-second toast.

## UX — Dashboard tile

New section `frontend/src/pages/Dashboard/BudgetEnvelopeSection.tsx`,
mounted in `Dashboard/index.tsx` between `InsightsSection` and
`MoyennesMensuellesSection`.

### Visibility rule

Fetches `/api/envelopes/report?month=<current>`. Renders only if either:

- `report.rows.length > 0`, or
- `report.pool.available !== "0.00"` and at least one income
  transaction exists.

Otherwise returns `null`. Caps-only users never see it — the same
graceful-hide pattern `UnbudgetedSection` uses.

### Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  Enveloppes · juillet 2026                            Voir tout →  │
│                                                                    │
│   Disponible          Assigné         Sur-budget        Retenu     │
│   €1 240,00           €16 900,00      3 catégories      €0,00      │
│                       (▓▓▓▓▓░ 92%)    ⚠                            │
└────────────────────────────────────────────────────────────────────┘
```

- **Disponible** — headline = `pool.available`. Red if negative.
- **Assigné** — `assignedCumul` with a mini progress bar
  `assigned / income`, soft-capped at 100%.
- **Sur-budget** — count of overspent rows; chip red when > 0; click
  routes to `/budgets/enveloppes?month=YYYY-MM`.
- **Retenu** — `heldForNextMonth`. Dimmed when zero; not hidden — keeps
  the four-column grid stable month to month.
- **Voir tout** — link to `/budgets/enveloppes?month=YYYY-MM`.

### Deliberately not on the tile

- No per-envelope rows.
- No target progress bars.
- No mutations.
- No month picker — always current month; the Enveloppes page is where
  historical browsing lives.

## File plan

### Backend

- `backend/src/db/migrations/0024_envelope_assignments.sql`
- `backend/src/db/migrations/0025_envelope_category_settings.sql`
- `backend/src/db/migrations/0026_envelope_month_holds.sql`

(0023 is already taken by `0023_dismissed_tips.sql`; envelope migrations
begin at 0024.)
- `backend/src/db/schema.ts` — three new Drizzle table defs; comment
  update on `categoryBudgets` clarifying it now models caps.
- `backend/src/http/routes/envelopes.ts` — new route module (assignments,
  reallocate, categories, holds, report).
- Register `envelopesRoutes` where `budgetsRoutes` is registered.
- `backend/src/lib/envelope-math.ts` — pure math (pool, balance,
  reallocate-absorb).
- `backend/tests/envelope-math.test.ts` — table-driven fixtures for all
  formulas above.
- `backend/tests/envelopes-route.test.ts` — CRUD, reallocate atomicity,
  report shape stability, expense-only guard, cascade on category delete.

### Frontend

- `frontend/src/App.tsx` — routes:
  `/budgets` → redirect to `/budgets/plafonds`;
  `/budgets/plafonds` → `<Plafonds />`;
  `/budgets/enveloppes` → `<Enveloppes />`.
- `frontend/src/components/Layout.tsx` — Budgets nav item becomes a hub
  with two children.
- Rename `pages/Budgets/Budgets.tsx` → `pages/Budgets/Plafonds.tsx`.
- New folder `pages/Budgets/Enveloppes/`:
  `Enveloppes.tsx`, `PoolCard.tsx`, `EnvelopeRow.tsx`,
  `ReallocateModal.tsx`, `SettingsModal.tsx`, `HoldModal.tsx`.
- `pages/Budgets/envelope-math.ts` — client mirror of server formulas.
- `lib/useEnvelopes.ts` — TanStack Query hooks; keys:
  `['envelopes','report',month]`, `['envelopes','settings']`,
  `['envelopes','holds',{from,to}]`.
- `api/types.ts` — new types: `EnvelopeAssignment`,
  `EnvelopeCategorySettings`, `EnvelopeHold`, `EnvelopeReport`,
  `TargetKind`, `OverspendPolicy`.
- `frontend/src/pages/Dashboard/BudgetEnvelopeSection.tsx` — new tile.
- Amend `pages/Dashboard/index.tsx` — one import, one JSX line.
- Tests: `envelope-math.test.ts`, `Enveloppes.test.tsx`,
  `PoolCard.test.tsx`, `EnvelopeRow.test.tsx`,
  `BudgetEnvelopeSection.test.tsx`, updated `Layout.test.tsx` and
  `redirects.test.tsx`.

## Rollout

- Ships on `main` in one series of commits — no feature flag. LAN-only,
  single-user app; blast radius is contained.
- On first deploy: existing caps user sees the new "Enveloppes"
  sub-entry, clicks it, lands on the empty state. Zero data change.
- Migrations 0024–0026 are additive; `category_budgets` is untouched.
- Old `/budgets` URL bookmarks work via the redirect, verified in
  `redirects.test.tsx`.

## Public-safe check

No IPs, hostnames, secrets, or personal identifiers. French UI labels
are user-facing text (fine to commit publicly). New file bylines
attribute to `Gekkotron` where present.

## Implementation order (for the plan)

1. Migrations 0024–0026 + Drizzle schema entries.
2. `envelope-math.ts` (server) + math tests — pure code, no HTTP.
3. Routes + route tests.
4. Frontend types + `useEnvelopes` hooks.
5. Nav restructure + `/budgets` redirect + rename `Budgets.tsx` → `Plafonds.tsx`.
6. `Enveloppes.tsx` + `PoolCard` + `EnvelopeRow` — read-only first, then inline edit.
7. Reallocate modal + hold modal + settings modal.
8. Empty / error states, target progress rendering, "Non budgétées" folded in.
9. Dashboard tile `BudgetEnvelopeSection` + tests.
10. Wiki entry for the two-mode Budget section.

## Out of scope (v1.1 candidates)

- Bulk "copy last month's assignments" endpoint + button.
- Drag-and-drop reallocation.
- Multi-currency.
- Undo history beyond the 5-second toast.
