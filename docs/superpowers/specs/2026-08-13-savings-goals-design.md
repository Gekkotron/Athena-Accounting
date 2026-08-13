# Savings goals (piggy banks) — design spec

**Date:** 2026-08-13
**Status:** Approved (brainstorming), pending implementation plan

## Goal

Firefly III-style savings targets attached to an account. Each goal has a name,
a target amount, and an optional target date. Progress is tracked by explicit
contribution and withdrawal events the user records against the goal. Multiple
goals can live on the same account, letting a single Livret A carry
`Vacances 2 000 € / Fond d'urgence 5 000 € / Buffer` side by side.

Athena is a retrospective ledger. Savings goals do not touch the real ledger —
they are a **layer of intent** on top of an account's real balance, capturing
how the user has mentally partitioned it. Recording a contribution does not
create a transaction, and creating a transaction does not credit any goal.

## Decisions (locked during brainstorming)

- **Attached to an account** — every goal belongs to exactly one account,
  inherits its currency, and is deleted when the account is deleted.
- **Many goals per account** — a single Livret A can host any number of
  goals. Uniqueness constraint is on `(user_id, account_id, name)`, not on
  `(user_id, account_id)`.
- **Contributions-based, not balance-derived** — progress is
  `SUM(events.amount)` per goal, not a fraction of the account balance. This
  is the backlog's hint: many-goals-per-account makes balance-derived
  ambiguous (a single balance can't be split across N goals without an
  arbitrary weighting scheme), and contributions-based survives account
  merges (an event just repoints to the merged account, whereas a
  balance-derived progress would jump discontinuously the moment two
  accounts fuse).
- **Deadline drives a projection** — when `target_date` is set, the goal
  card shows a `X €/mois pour tenir la date` line
  (`ceil((target − saved) / months_remaining)`) or an `en retard de N jours`
  line when the date has passed and the target is not reached. When
  `target_date` is null, both lines are hidden.
- **Full three-way surfacing** — dedicated `/goals` page (full CRUD), an
  "Objectifs" strip on each `AccountCard`, and a `SavingsGoalsSection`
  widget on the Dashboard showing the three soonest goals.
- **Currency inherited from the account** — no `currency` column on the
  goal. Athena has no FX yet, and letting a goal declare a currency
  different from its account would silently lie.
- **Balance sanity is advisory, not enforced** — `SUM(saved_amount)` on
  goals of a single account can exceed the account's current balance;
  Athena is retrospective and the user is authoritative. The overrun is
  surfaced as an amber warning by the UI, joining the goals list with
  the account balance client-side (no duplicated SQL — see § API).
- **Overshoot is allowed; completion is not automatic** — going over the
  target does not auto-close the goal. `progressPct` clamps at 100 for the
  bar; `rawPct` reports the real ratio for a "108 % réalisé" label. The
  event response carries `justReached: true` on the transition crossing
  100 %, powering a one-shot success toast.

## Data model

Migration `0036`. Two new tables.

### `savings_goals`

| column          | type              | notes                                              |
|-----------------|-------------------|----------------------------------------------------|
| `id`            | serial PK         |                                                    |
| `user_id`       | int NOT NULL      | FK `users(id)` ON DELETE CASCADE                   |
| `account_id`    | int NOT NULL      | FK `accounts(id)` ON DELETE CASCADE                |
| `name`          | text NOT NULL     |                                                    |
| `target_amount` | numeric(14,2)     | CHECK `> 0`                                        |
| `target_date`   | date NULL         | drives the projection when set                     |
| `color`         | varchar(9) NULL   | optional accent, same shape as `categories.color`  |
| `closed_at`     | timestamptz NULL  | non-NULL = archived                                |
| `created_at`    | timestamptz       | DEFAULT `now()`                                    |
| `updated_at`    | timestamptz       | DEFAULT `now()`                                    |

- `UNIQUE (user_id, account_id, name)`.
- No status enum: `closed_at IS NULL` vs `NOT NULL` is the whole state
  machine.

### `savings_goal_events`

| column       | type            | notes                                                     |
|--------------|-----------------|-----------------------------------------------------------|
| `id`         | bigserial PK    |                                                           |
| `user_id`    | int NOT NULL    | FK `users(id)` ON DELETE CASCADE                          |
| `goal_id`    | int NOT NULL    | FK `savings_goals(id)` ON DELETE CASCADE                  |
| `amount`     | numeric(14,2)   | positive = contribution, negative = withdrawal. CHECK `<> 0` |
| `event_date` | date NOT NULL   |                                                           |
| `note`       | text NULL       |                                                           |
| `created_at` | timestamptz     | DEFAULT `now()`                                           |

- Index `(goal_id, event_date DESC)` — powers the drawer's "recent
  activity" list and the aggregate.
- Same signed-amount convention as `transactions.amount`.

### Account merge interaction

`backend/src/http/routes/accounts/merge.ts` currently repoints
transactions, splits, patterns, and checkpoints from source → target. A new
**Step E-bis** repoints `savings_goals.account_id`. Name collisions on the
target account are resolved by appending ` (from <source name>)` to the
migrated goal's name — the codebase's non-destructive convention. Events
follow their goal via `goal_id`, no per-event repoint needed.

### Account deletion

`account_id … ON DELETE CASCADE` — deleting an account deletes its goals
and their events. Matches how `category_budgets` and `balance_checkpoints`
behave.

## API

All routes are auth-protected, `user_id`-scoped, and follow the codebase's
non-enumeration 404 convention (cross-user access returns 404, not 403). New
folder `backend/src/http/routes/goals/` with `crud.ts`, `events.ts`,
`list.ts`, `schemas.ts`, `index.ts`, mirroring the accounts layout.

### Goals resource

| Method | Path                        | Body / Query                                             | Notes                                                                   |
|--------|-----------------------------|----------------------------------------------------------|-------------------------------------------------------------------------|
| GET    | `/api/goals`                | `?includeClosed=0`                                       | List with computed `savedAmount`, `progressPct`, `rawPct`, `perMonthNeeded`, `overdueDays`, `eventCount`, `currency`. Batched aggregate. |
| POST   | `/api/goals`                | `{ accountId, name, targetAmount, targetDate?, color? }` | 400 on non-positive target; 404 on foreign account (non-enumeration); 409 on duplicate `(accountId, name)`. |
| GET    | `/api/goals/:id`            | —                                                        | Single goal with the same computed columns.                             |
| PUT    | `/api/goals/:id`            | `{ name?, targetAmount?, targetDate?, color? }`          | Partial patch. Same 400/409 rules.                                      |
| POST   | `/api/goals/:id/close`      | —                                                        | Sets `closed_at = now()`. 409 if already closed.                        |
| POST   | `/api/goals/:id/reopen`     | —                                                        | Sets `closed_at = NULL`. 409 if not closed.                             |
| DELETE | `/api/goals/:id`            | —                                                        | Hard delete; events cascade.                                            |

### Events sub-resource

| Method | Path                                     | Body                            | Notes                                                                 |
|--------|------------------------------------------|---------------------------------|-----------------------------------------------------------------------|
| GET    | `/api/goals/:id/events`                  | `?limit=50&before=<id>`         | Reverse-chronological, keyset paginated on `id`.                      |
| POST   | `/api/goals/:id/events`                  | `{ amount, eventDate, note? }`  | `amount` non-zero. 400 on write to a closed goal. Response includes `justReached: boolean`. |
| PUT    | `/api/goals/:id/events/:eventId`         | `{ amount?, eventDate?, note? }`| Full editability — corrections are direct, not via offsetting entries. |
| DELETE | `/api/goals/:id/events/:eventId`         | —                               | Direct delete; the UI uses the same 5-second undo-toast pattern as Transactions (`useDeferredDelete`). |

### List computed columns

One aggregate query, same style as `accounts/list.ts`:

```sql
SELECT
  g.id, g.account_id, g.name, g.target_amount::text AS target_amount,
  g.target_date, g.color, g.closed_at,
  a.currency AS currency,
  COALESCE((SELECT SUM(e.amount)  FROM savings_goal_events e WHERE e.goal_id = g.id), 0)::text AS saved_amount,
  COALESCE((SELECT COUNT(*)       FROM savings_goal_events e WHERE e.goal_id = g.id), 0)::int  AS event_count
FROM savings_goals g
JOIN accounts a ON a.id = g.account_id
WHERE g.user_id = $1
  AND ($2::bool OR g.closed_at IS NULL)
ORDER BY g.closed_at NULLS FIRST, g.created_at ASC;
```

- `rawPct = saved / target * 100` — real ratio (unclamped).
- `progressPct = min(100, rawPct)` — clamped for the bar; same
  green/amber/red bands as Budgets (`<80` green, `80–100` amber, `>100`
  red — determined off `rawPct`, so overshoots read red).
- `perMonthNeeded`:
  - if `target_date` is set and `target_date > today`:
    `ceil((target − saved) / months_remaining)`;
  - if `target_date` is set and `target_date <= today` and `saved < target`:
    `null`, and `overdueDays = today − target_date`;
  - if `target_date` is null: both `perMonthNeeded` and `overdueDays` are
    `null`.
- The list response carries a top-level `perAccount: { [accountId]:
  { savedSum: string } }` map — `savedSum` is `SUM(saved_amount)` across
  all non-closed goals on the account, in one aggregate over the same
  subquery. Whether `savedSum > currentBalance` (the `overReserved` amber
  warning) is decided **client-side** by joining this map with the
  existing `useAccounts` hook — the balance-computation SQL from
  `accounts/list.ts` is not duplicated into the goals route.

### Balance sanity — advisory, not enforced

Rejected: enforcing `SUM(saved) <= currentBalance` at the API. Athena is
retrospective and the user's `+200 €` intent may precede the bank statement
that will land tomorrow. Instead: `overReserved` is a per-account flag on
the list response consumed by the UI to render an amber warning strip.

### Completion — auto-close vs overshoot

- `POST /events` that pushes `saved` across the target from below sets
  `justReached: true` on the response. The UI fires a one-shot success
  toast (no emoji in the default copy; Athena's "no emojis" default holds
  — see `frontend/src/locales/{fr,en}/goals.json`).
- The goal is **not** auto-closed. Users close explicitly via
  `POST /:id/close`. Overshoot stays visible until they do.

## Frontend surfaces

### Dedicated `/goals` page

- New folder `frontend/src/pages/Goals/` with `index.tsx`, `GoalCard.tsx`,
  `GoalForm.tsx`, `GoalDetailDrawer.tsx`, `EventRow.tsx`, `goal-math.ts`
  (pure helpers: `progressPct`, `perMonthNeeded`, `colorBand`).
- Sidebar entry `{ to: '/goals', label: 'Objectifs', icon: 'goals' }`,
  placed after *Budgets*. New `goals` icon in `NavIcons.tsx` — piggy-bank
  line-art, single stroke, matches the existing set.
- Layout: sectioned by account. Each section header shows the account
  name, currency, and a `réservé X / disponible Y` strip that renders in
  amber when `overReserved` is true. Under each header, a grid of
  `GoalCard`s.
- `GoalCard` — name, target, progress bar (green / amber / red by
  `rawPct`), deadline line
  (`↣ 143 €/mois pour tenir la date` OR `en retard de N jours` OR hidden),
  and a click affordance that opens `GoalDetailDrawer`.
- `GoalDetailDrawer` — right-side drawer, same pattern as
  `BalanceCheckpointsDrawer`: editable name/target/date/color at the top,
  an "Ajouter / Retirer" form, an event list with inline edit + delete
  (undo-toast on delete matching `useDeferredDelete` in Transactions), a
  "Clore l'objectif" / "Réouvrir" button in the header, and a red
  "Supprimer l'objectif" at the bottom (behind `ConfirmDialog`).
- Empty state — friendly explainer + CTA to add the first goal.
- Filter — "Afficher les objectifs clos" toggle above the account
  sections; passes `?includeClosed=1` when on.
- Privacy blur — every amount respects `PrivacyContext.blur`.

### `AccountCard` panel

- Under the balance line on each `AccountCard`
  (`frontend/src/pages/Accounts/AccountCard.tsx`), a compact "Objectifs"
  strip: one row per non-closed goal, mini progress bar and `saved /
  target`. Each row is a link to `/goals?highlight=<id>` (deep-link
  scrolls to and briefly ring-highlights the goal).
- Empty state — a subdued `+ Ajouter un objectif` chip that opens the
  create form as a modal, so the common case doesn't require leaving the
  Comptes page.

### Dashboard widget

- New `SavingsGoalsSection.tsx` under `frontend/src/pages/Dashboard/`,
  placed between `BudgetEnvelopeSection` and `SankeySection`.
- Shows up to 3 goals with the soonest `targetDate` (nulls last,
  tie-break by lowest `rawPct`), rendered as compact cards. A "Voir tous
  les objectifs (N)" link routes to `/goals`. Renders nothing when no
  goals exist (Dashboard stays dense; the CTA lives on the Goals and
  Accounts surfaces).
- Loading and error states reuse the same skeleton and `ErrorState`
  patterns as `InsightsSection` and `SankeySection`.

### i18n

- New key namespaces `frontend/src/locales/{fr,en}/goals.json` — labels,
  form errors, empty states, plural forms for event counts
  (`event_one` / `event_other`).
- Sidebar label added to `layout.json`; dashboard section title added to
  `dashboard.json`.

### File-size gates

`GoalDetailDrawer.tsx` is the file most at risk of the 300-line frontend
cap — `BalanceCheckpointsDrawer.tsx` sits at 8.6K. If it approaches the
gate the event list is split into its own `EventList.tsx` from the outset.
`Goals/index.tsx` similarly delegates account-section rendering to
`GoalCard.tsx`.

## Demo mode

- `frontend/src/api/demo/seed.ts` — three seeded goals across the demo's
  existing accounts:
  1. **Livret A → "Vacances 2027"** — target 2 000 €, deadline 12 months
     out, ~40 % filled from six seeded monthly events of 130 €. Shows
     the projection line at full swing.
  2. **Livret A → "Fond d'urgence"** — target 5 000 €, no deadline, ~50 %
     filled from three larger events. Shows the null-deadline branch
     and multi-goal-per-account layout.
  3. **Compte courant → "Prochain iPhone"** — target 1 200 €, deadline in
     the past by ~40 days, only 300 € saved. Shows the "en retard"
     amber branch.
- New `frontend/src/api/demo/handlers/goals.ts` — full in-memory CRUD
  backed by the seeded arrays. Follows the read-write handler pattern
  (accounts, budgets), not the 501-stub pattern (that pattern is for
  bank-sync-style external-service surfaces).
- The event log lives in-memory too; deleting and editing mutate the same
  array.
- The dashboard widget and AccountCard panel pick up the seeded data via
  the same query hooks as production — no demo-specific branching in
  components.

## Backup

`savings_goals` and `savings_goal_events` join the backup payload as two
new **optional** arrays — the same additive precedent used for
`category_budgets`, `balance_checkpoints`, and `transaction_splits`.
Payload `VERSION` stays as-is; old backups without the arrays still
validate.

Natural-key remap on restore:

- Each exported goal carries its account by **name**. Restore resolves the
  name back to the new account id in the target user. Goals whose account
  did not restore are silently skipped, with the count surfaced in the
  restore summary.
- Each exported event carries its parent goal by `(accountName,
  goalName)`. Restore resolves that pair to a new `goal_id`. Events whose
  parent did not resolve are skipped, counted, and reported.
- `closed_at` and `target_date` round-trip as ISO strings.

`backup/wipe.ts` — multi-user DELETE path explicitly clears
`savings_goal_events` then `savings_goals` (cascade would handle it too;
kept explicit for readability, matching the `transaction_attachments`
addition in migration `0034`). Single-user TRUNCATE list gains both
tables.

## Testing

**Backend** (under the existing `RUN_DB_TESTS` gate):

- Goals CRUD: create, list, get, update, close, reopen, delete.
- Events CRUD: create, list keyset-paginated, edit, delete.
- Validation: non-positive target → 400; zero amount → 400; foreign
  account / goal → 404 (non-enumeration); duplicate
  `(accountId, name)` → 409; write to a closed goal → 400; close an
  already-closed goal → 409; reopen a non-closed goal → 409.
- Aggregate math: `savedAmount = SUM(events)`; `progressPct` bands (green
  / amber / red); `perMonthNeeded` for future dates; `overdueDays` for
  past dates; `justReached` fires exactly on the transition crossing
  target (not on a follow-up event that stays above).
- User isolation: user A cannot see or mutate user B's goals or events.
- Account merge: a goal-name collision on the target auto-renames with
  the ` (from …)` suffix; events follow their goal — test lives beside
  the existing checkpoints case in `merge.route.test.ts`.
- Account delete cascades wipe goals and events.
- Backup round-trip: two goals + N events survive export → restore,
  re-link by name; an unresolvable account's goals are skipped and
  counted.

**Frontend** (Vitest + Testing Library):

- `Goals/index.tsx` renders sections per account with correct band
  colours; empty state; "Afficher clos" toggle passes `?includeClosed=1`.
- `GoalCard` shows the `perMonthNeeded` line for future dates, "en
  retard" for past dates, hides the line when `targetDate` is null.
- `GoalForm` — creates with valid data, blocks non-positive targets,
  surfaces the server 409 duplicate-name message.
- `GoalDetailDrawer` — adds a positive event, adds a negative event,
  edits an event, deletes with the 5-second undo window, closes and
  reopens the goal.
- `AccountCard` panel — renders the strip, "+ Ajouter" chip opens the
  create modal, deep-link to `/goals?highlight=<id>` works.
- `SavingsGoalsSection` on Dashboard — renders up to 3, sort order
  (soonest deadline first, tie-break by lowest `rawPct`), routes to
  `/goals`, renders nothing when empty.
- Privacy blur hides amounts across all three surfaces when active.

## Out of scope (explicitly)

- Multi-currency conversion — waits on the manual FX table spec.
- Goal tagging beyond `color`.
- Recurring auto-contribution (a rule saying "reserve 200 € on the 1st
  of every month" — a follow-up feature; the events schema already
  supports it).
- Notifications or email on completion.
- Linking a goal event to a specific bank transaction — deliberately
  rejected during brainstorming (§ Contributions-based, not
  balance-derived).
