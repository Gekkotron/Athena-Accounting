# Graph anchor points (balance checkpoints) — design

**Status:** Draft (awaiting user review)
**Date:** 2026-07-01
**Scope:** v1 — per-account manual reconciliation markers rendered on the Dashboard balance chart.

## Goal

Let the user record, per account, one or more `(date, expected_amount)` pairs — typically read off a bank statement — and display them as distinct markers on that account's balance chart. If the computed cumulative balance on the same date differs from the expected value beyond a one-cent tolerance, the marker renders in a drift style with a short vertical guide to the actual value. This gives the user a purely visual "does my imported data match reality?" signal without any manual arithmetic.

## Non-goals (v1)

- Automatic drift alerts (banners, notifications, "investigate this month" suggestions). The chart shows drift visually; the user follows up manually.
- Reconciliation across multiple accounts or an "all accounts" total view. Checkpoints are per-account and only visible when a specific account is selected on the Dashboard.
- Bulk import of checkpoints from CSV or from a bank statement's summary block. Manual CRUD only.
- Per-checkpoint or per-account tolerance override. Tolerance is fixed at `0.01` (one currency unit's smallest fraction) globally.
- A dedicated "Reconciliation" page. All CRUD lives inside the Comptes page, next to the account it belongs to.

## Data model

One new table; nothing else in the schema is touched.

```sql
create table balance_checkpoints (
  id                serial primary key,
  account_id        integer not null references accounts(id) on delete cascade,
  checkpoint_date   date not null,
  expected_amount   numeric(18, 2) not null,
  note              text,
  created_at        timestamptz not null default now(),
  unique (account_id, checkpoint_date)
);

create index balance_checkpoints_account_idx on balance_checkpoints (account_id);
```

Notes:
- `unique (account_id, checkpoint_date)` prevents duplicate checkpoints on the same day for the same account and gives a natural upsert key.
- `on delete cascade` — deleting an account clears its checkpoints. Same policy as `account_filename_patterns`.
- `expected_amount` uses the same `numeric(18, 2)` shape as `accounts.opening_balance`, so no new casting rules on the frontend.
- `note` is a short free-form label (max 200 chars, enforced in the route, not the DB) — e.g. `"relevé BNP nov"`.

Migration file: `backend/src/db/migrations/NNNN_balance_checkpoints.sql`, applied at server boot by the existing migration runner. Drizzle's `schema.ts` gets a matching entry in the same PR.

## Backend API

Four routes nested under an account, in a new file `backend/src/http/routes/balance-checkpoints.ts`, registered from `server.ts` alongside the other account-scoped routes.

| Method   | Path                                                    | Body / query                                        | Returns                                                                                             |
|----------|---------------------------------------------------------|-----------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `GET`    | `/api/accounts/:id/balance-checkpoints`                 | —                                                   | `200 { checkpoints: [{ id, checkpointDate, expectedAmount, note }] }`, sorted by `checkpoint_date` asc |
| `POST`   | `/api/accounts/:id/balance-checkpoints`                 | `{ checkpointDate, expectedAmount, note? }`         | `201` with created row; `409 { error: 'checkpoint_exists', date }` on unique violation              |
| `PUT`    | `/api/accounts/:id/balance-checkpoints/:cpId`           | Partial: `{ expectedAmount?, note? }` (date is immutable — delete + recreate to move a checkpoint) | `200` with updated row; `404` if `:cpId` isn't owned by `:id`                                       |
| `DELETE` | `/api/accounts/:id/balance-checkpoints/:cpId`           | —                                                   | `204`; `404` if `:cpId` isn't owned by `:id`                                                        |

Behavior rules:
- All routes require an authenticated session (existing `auth` plugin).
- `checkpointDate` is validated as `YYYY-MM-DD`. `expectedAmount` accepted as string or number, coerced to a fixed-point string with two decimals before insert. `note` is trimmed and stored `null` when empty.
- Cross-account isolation: any `:cpId` whose parent `account_id` ≠ path `:id` returns `404`, not `403`. We do not leak the existence of the sibling row.
- No new endpoint under `/api/reports/*`. The chart computes drift client-side against the existing `/api/reports/timeseries` response — no reason to duplicate the join server-side, and the client already has the timeseries loaded.
- No behavior change to `/api/accounts` responses. Account cards do not embed checkpoint counts server-side; the Accounts page fetches per-account checkpoint lists lazily on drawer expansion.

## Frontend

### `BalanceChart` — chart rendering

Component gains one optional prop:

```ts
interface Props {
  points: BalancePoint[];
  currency: string;
  height?: number;
  checkpoints?: { date: string; expectedAmount: number; note?: string }[];
}
```

Rendering rules (only when `checkpoints?.length > 0`):

1. Drop any checkpoint whose `date` falls outside `[data[0].date, data[data.length - 1].date]`. The chart's X range is driven by transaction data, not checkpoints — orphan dots hanging off the edges would look broken.
2. For each remaining checkpoint, binary-search `data[]` for the **latest bucket whose date is `<= checkpointDate`** and read that bucket's cumulative as `actualAtDate`. This matches the forward-fill semantics already used inside the chart (see the "carry" logic in `BalanceChart.tsx`). The checkpoint is anchored at its own X (`xScale` of its real date), not snapped to the bucket, so a checkpoint on a day with no activity still lands on the correct X.
3. Compute `delta = expectedAmount - actualAtDate`. `Math.abs(delta) < 0.01` → **matched**; otherwise → **drifted**.
4. Draw, in an SVG `<g>` layered above the curve and below the hover overlay:
   - **Matched**: hollow sage-green diamond (7 px), 2 px stroke, no fill.
   - **Drifted**: filled amber diamond + a thin dashed vertical guide from `(xScale(date), yScale(expectedAmount))` to `(xScale(date), yScale(actualAtDate))`, terminated by a small tick on the actual value.
5. Distinct **diamond** shape (not circle) so checkpoints are unambiguous versus the end-of-series dot and the hover dot.
6. Hover: when the pinned bucket's X is within **12 viewBox units** (~1.2% of the chart width) of a checkpoint's X, the tooltip grows a second line showing `attendu / réel / écart` for drifted checkpoints, or `attendu ✓` for matched. Non-checkpoint days behave as today.

Colors reuse the existing palette (`sage-*`, `amber-*` / `clay-*`). Exact tokens picked on implementation from `index.css`.

The component has **no** concept of chart scope. It renders whatever checkpoints array it receives. Deciding when to pass an empty vs. populated list is the Dashboard's job (see below).

### Dashboard — data plumbing

`pages/Dashboard.tsx`:

- New TanStack Query:
  ```ts
  const checkpointsQ = useQuery({
    queryKey: ['balance-checkpoints', chartScope],
    queryFn: () => api<{ checkpoints: BalanceCheckpoint[] }>(`/api/accounts/${chartScope}/balance-checkpoints`),
    enabled: chartScope !== 'all',
  });
  ```
- Passed to the chart: when `chartScope !== 'all'`, map each `BalanceCheckpoint` from the API into the chart's shape by parsing the fixed-point string once — `{ date: c.checkpointDate, expectedAmount: Number(c.expectedAmount), note: c.note ?? undefined }`. When `chartScope === 'all'`, pass `undefined`.
- With `chartScope === 'all'` the query does not fire and the chart renders exactly as today.
- A subtle caption under the chart lists totals when at least one checkpoint exists: `"{N} point(s) de contrôle · {K} drift(s)"`. Purely informational; no click action.

### Accounts page — CRUD UI

`pages/Accounts.tsx`:

Each account card grows a new bottom section — an expandable **"Points de contrôle"** drawer.

- **Collapsed:** a `▸ Points de contrôle · N` line placed under the existing transaction counter row. Chevron rotates on toggle. Local `expanded: boolean` state per card.
- **Expanded:** an inline table
  ```
  date        | montant attendu | note                | actions
  02/12/2025  | 2 000,00 €      | relevé BNP nov      | ✎ ✕
  ```
  followed by a persistent add-row: `[date input] [amount input] [note input] [+ ajouter]`.
- **Editing** an existing row: click the amount or note cell → inline edit (same interaction as the transaction category cell in `Transactions.tsx`). Enter saves via `PUT`; blur commits if changed, otherwise reverts.
- **Delete** uses the existing `ConfirmDialog` component.
- **Empty state**: `"Aucun point de contrôle. Ajoutez-en un pour vérifier vos soldes contre un relevé."` in the drawer body.

The drawer's data comes from the same query key used by the Dashboard (`['balance-checkpoints', accountId]`). Any mutation in the drawer invalidates that key, so the next Dashboard visit reflects the change automatically.

### New frontend files

- `frontend/src/api/checkpoints.ts` — typed wrappers: `listCheckpoints(accountId)`, `createCheckpoint(accountId, body)`, `updateCheckpoint(accountId, cpId, patch)`, `deleteCheckpoint(accountId, cpId)`. Same style as existing `api/*.ts` files.
- Type in `frontend/src/api/types.ts`:
  ```ts
  export interface BalanceCheckpoint {
    id: number;
    accountId: number;
    checkpointDate: string;  // YYYY-MM-DD
    expectedAmount: string;  // fixed-point string, per project convention
    note: string | null;
  }
  ```

No new component file is created for the drawer. It lives as a small local subcomponent inside `Accounts.tsx`, mirroring `PatternsSection`'s placement at the bottom of the same file.

## Error handling

- **Backend**
  - `400` on invalid `checkpointDate` format, non-numeric `expectedAmount`, `note` longer than 200 chars, or missing account.
  - `409` on `(account_id, checkpoint_date)` unique violation, with `{ error: 'checkpoint_exists', date }`. The frontend maps that to an inline error under the date field: `"Un point de contrôle existe déjà à cette date."`
  - `404` for a mismatched `(id, cpId)` pair, matching the "no existence leak" pattern used elsewhere.
  - Auth failure → `401`, standard.
- **Frontend**
  - `BalanceChart` treats any malformed checkpoint (NaN amount, unparsable date, date outside the plotted window) as silently dropped. No red banner — the chart should degrade to "no checkpoint shown" rather than throw.
  - Accounts drawer mutations show inline error text under the offending field on `400` / `409`. A toast is used only for network / `500`.

## Testing

- **Backend** — `backend/tests/balance-checkpoints.test.ts`:
  - CRUD happy path.
  - Uniqueness conflict returns `409`.
  - Cross-account isolation: `PUT` and `DELETE` on a `cpId` whose `account_id` ≠ path `:id` → `404`.
  - Cascade delete: removing the parent account removes its checkpoints (raw SQL check after `DELETE`).
  - `note` length cap enforced with `400`.
- **Frontend**
  - Project has no e2e harness today; UI verified manually per the CLAUDE.md guidance: start the dev stack (`docker compose up --build`), create a checkpoint that matches (should render sage), one that drifts (should render amber with a guide line), one outside the data range (should be silently dropped), and confirm switching the chart scope to `all` hides everything.

## Rollout

- Single PR.
- No feature flag. The feature is additive and invisible until the user creates a first checkpoint — the chart is unchanged for accounts with zero checkpoints.
- Migration runs at container boot on the next `docker compose up`, per existing pattern. No data backfill needed — table starts empty.
- README: add a short paragraph under the Dashboard section describing reconciliation checkpoints; Roadmap gets a new `[x] Étape 12 — Points de contrôle (réconciliation visuelle)`.

## Open questions

None at time of writing. Any surfaced during implementation get logged here before code changes.
