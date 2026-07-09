# Transactions: "validate balance" checkpoint checkbox

**Date:** 2026-07-09
**Status:** Approved, ready for implementation plan

## Goal

Let the user create (and remove) a balance checkpoint straight from the
Transactions screen by ticking a checkbox on a transaction row — "I confirm the
account balance is correct up to here." The checkpoint then appears on the
balance chart and in the Accounts checkpoints drawer.

## Background

A **balance checkpoint** (`balance_checkpoints` table) is a manual
reconciliation marker: `(account_id, checkpoint_date, expected_amount, note)`,
unique per `(account_id, checkpoint_date)`. It is not tied to any transaction.
There is **no persisted "validated" flag**; the chart live-compares a
checkpoint's `expectedAmount` to the computed balance and colours it matched
(green) or drifted (amber).

The Transactions list already shows a per-row running balance ("Solde") when the
view is scoped to a single account and sorted by date
(`showBalance = filters.accountId != null && filters.sort === 'date'`), using the
same balance basis as the chart and the Accounts page.

This feature is **frontend-only**. It reuses the existing endpoints and client:
- `GET /api/accounts/:id/balance-checkpoints` → `listCheckpoints(accountId)`
- `POST /api/accounts/:id/balance-checkpoints` → `createCheckpoint(accountId, { checkpointDate, expectedAmount, note? })`
- `DELETE /api/accounts/:id/balance-checkpoints/:cpId` → `deleteCheckpoint(accountId, cpId)`

Checkpoint queries use the key prefix `['balance-checkpoints', …]` (drawer:
`['balance-checkpoints', accountId]`; dashboard chart:
`['balance-checkpoints', chartScope]`), so invalidating `['balance-checkpoints']`
refreshes both.

## When the checkbox is shown

Same gate as the Solde column: `filters.accountId != null && filters.sort === 'date'`.
Additionally, only on the **end-of-day row** of each date (see below), and only
when that row has a `runningBalance` (pre-opening rows have none and are
skipped).

## End-of-day row

A checkpoint is unique per `(account, date)`, so at most one checkbox per date.
It is anchored to the day's **chronologically last transaction** — the row with
the greatest `id` among the rows sharing that date in the current page. That
row's `runningBalance` is the end-of-day balance, which is what gets stored and
what the chart reconciles against.

Determination is a pure function over the currently-rendered page rows:

```
endOfDayRowIds(transactions: {id: number; date: string}[]): Set<number>
```

Returns the set of row ids that are the max-id row for their date. Days with a
single transaction naturally yield that one row.

**Pagination note:** because this is computed per page, a single date split
across a 50-row page boundary can show the checkbox on its last row *on that
page* rather than the true end-of-day row. Rare (few txns per day); documented
with a code comment, not engineered around.

## Behaviour

- **Checked state** = a checkpoint exists at that row's date for the selected
  account (looked up in a `Map<checkpointDate, BalanceCheckpoint>` built from
  `listCheckpoints`).
- **Unchecked → checked:** `createCheckpoint(accountId, { checkpointDate: tx.date, expectedAmount: tx.runningBalance, note: null })`.
- **Checked → unchecked:** `deleteCheckpoint(accountId, checkpoint.id)`.
- On success (create or delete): `invalidateQueries({ queryKey: ['balance-checkpoints'] })` so the drawer and chart update.
- The checkbox is `disabled` while its own create/delete mutation is pending.
- If a checkpoint already exists at that date with a different amount (e.g.
  entered from a bank statement), the box shows checked and is **not**
  overwritten on interaction; unticking deletes it. No drift styling here — the
  chart already surfaces drift.

## UI

- Placed **inside the Solde cell**, before the amount, as a small checkbox
  (`accent-sage-300`, matching the existing selection checkbox style), with an
  accessible label / `title` like "Valider ce solde comme point de contrôle".
- Only rendered on end-of-day rows meeting the conditions above; other Solde
  cells render just the amount as today.
- Split sub-rows are unaffected (they never carry the checkbox).

## Component changes

- `frontend/src/pages/Transactions/index.tsx`
  - New query (enabled when `filters.accountId != null`):
    `useQuery({ queryKey: ['balance-checkpoints', filters.accountId], queryFn: () => listCheckpoints(filters.accountId!) })`.
  - Build `checkpointByDate: Map<string, BalanceCheckpoint>` from the result.
  - `create` and `remove` mutations (using `createCheckpoint` / `deleteCheckpoint`),
    both invalidating `['balance-checkpoints']` on success.
  - Pass `checkpointByDate` and an `onToggleCheckpoint(tx, checked)` handler down.
- `frontend/src/pages/Transactions/TransactionsTable.tsx`
  - Compute `endOfDayRowIds(transactions)` once.
  - Pass to each `TransactionRow`: `isEndOfDay` (id ∈ set), the checkpoint for
    `tx.date` (or undefined), a `checkpointPending` flag, and the toggle handler.
- `frontend/src/pages/Transactions/TransactionRow.tsx`
  - In the Solde cell, when `showBalance && isEndOfDay && tx.runningBalance != null`,
    render the checkbox (checked iff a checkpoint exists) next to the amount;
    `onChange` calls the toggle handler; `disabled` while pending.
- `frontend/src/pages/Transactions/endOfDay.ts` (new) — the pure
  `endOfDayRowIds` helper.

## Out of scope (YAGNI)

- A persisted "validated" flag / new DB column (explicitly not this feature).
- Drift/amber styling of the checkbox in the Transactions screen.
- Editing a checkpoint's amount/note from the Transactions screen (that stays in
  the drawer).
- Bulk validate / range validate.
- Reconciling checkbox state across page boundaries for a day-straddling date.

## Testing

- **Unit** (`endOfDay.test.ts`): `endOfDayRowIds` picks the max-id row per date;
  single-transaction days; multiple dates; empty input.
- **Render** (`TransactionRow.test.tsx`, extend existing): with `showBalance` and
  `isEndOfDay` true, the checkbox renders; unchecked when no checkpoint, checked
  when one is passed; toggling fires the handler; not rendered on a
  non-end-of-day row or when `runningBalance` is absent.
