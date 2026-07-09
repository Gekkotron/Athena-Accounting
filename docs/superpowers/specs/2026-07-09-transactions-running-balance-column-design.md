# Transactions: running-balance column

**Date:** 2026-07-09
**Status:** Approved, ready for implementation plan

## Goal

Add a running-balance ("Solde") column to the Transactions table — the account
balance *after* each transaction, like a bank statement. The column appears only
when the view is scoped to a single account and sorted by date, i.e. only when a
running balance is actually meaningful.

## Background

The transactions list is a server-paginated web view
(`frontend/src/pages/Transactions/`), 50 rows per page, sortable by
`date | amount | label` (asc/desc) and filterable by account, category, source
file, date range, free-text search, and amount. It backs onto
`GET /api/transactions` (`backend/src/http/routes/transactions/index.ts`).

The table already shows the account *name* ("Compte"). Neither the transaction
DB table nor the API type carries any per-row balance. Balance data lives on the
account: `accounts.openingBalance` (stored) and `currentBalance` (computed
server-side). A cumulative balance is computed today only for the dashboard chart
(`reports.ts`), never per transaction row. Columns are not user-configurable;
only sort is. So this is new work on both backend and frontend.

## When the column is shown

Render the column **only when both**:

- `filters.accountId` is set (exactly one account selected), AND
- `filters.sort === 'date'` (either `asc` or `desc`).

In every other view (no account filter, or sorted by amount/label) the column is
absent — both the header `<th>` and every cell. This is an automatic behavior,
not a manual toggle.

## Definition of the running balance

For a transaction `t` belonging to account `a`:

```
runningBalance(t) = a.openingBalance
                  + Σ amount(x)  for all x in account a
                    ordered by (date asc, id asc), up to and including t
```

Key properties:

- Computed over the account's **full transaction history**, independent of the
  current page, sort order, and row filters. The value is *intrinsic* to a
  transaction's chronological position, so pagination and filtering never distort
  it — the page just displays each returned row's precomputed value.
- **Includes transfer rows** (`transferGroupId` not null) even though the list
  hides them by default (`includeTransfers` false). The balance must reflect
  reality.
- Consistency check: the chronologically-last transaction's running balance
  equals the account's `currentBalance` (both are `openingBalance + Σ all
  amounts`).

## Backend

File: `backend/src/http/routes/transactions/index.ts` (list handler).

Compute the running balance **only when `q.accountId` is present** (the only case
the frontend can display it):

1. Load the account's `openingBalance` (`accounts` table, scoped to `accountId` +
   `userId`).
2. Query that account's rows for balance purposes:
   `select { id, amount } from transactions where accountId = q.accountId AND
   userId = uid order by date asc, id asc`. This is a separate query from the
   filtered/paginated list query, deliberately unfiltered by the row filters so
   it sees the full history (transfers included).
3. Accumulate in JS via a small pure helper
   `computeRunningBalances(rows: {id, amount}[], openingBalance: string):
   Map<number, string>` — running sum from the opening balance, values formatted
   as 2-dp numeric strings consistent with `amount`.
4. Attach `runningBalance?: string` to each row in the paginated result before
   `hydrateSplits` / the response. (Every returned row's id is in the map when
   `accountId` is set.)

When `q.accountId` is absent, skip all of the above and return rows without
`runningBalance`.

This mirrors the codebase's stated "homelab scale, seq scans acceptable"
philosophy (see the note at `transactions/index.ts:~188`); the extra query is one
indexed scan of a single account's rows.

## API type

File: `frontend/src/api/types.ts` — add optional `runningBalance?: string` to the
`Transaction` interface. Also add it to the backend's response typing if one
exists mirroring this shape.

## Frontend

- `TransactionsTable.tsx`: derive
  `const showBalance = filters.accountId != null && filters.sort === 'date';`
  Conditionally render a `<th>` "Solde" (right-aligned, placed after "Montant").
  Bump the empty-state `colSpan` by 1 when `showBalance` is true.
- `TransactionRow.tsx`: conditionally render a `<td>` showing
  `tx.runningBalance` formatted with the account's currency using the same
  formatter as the Montant cell, in a neutral (not gain/loss) color. Split
  sub-rows render a matching empty `<td>` when `showBalance` is on so column
  alignment holds.
- Pass `showBalance` (or the raw `filters`) from table down to rows.

## Edge cases & notes

- **Transfer jumps:** with transfers hidden (default), a visible row's balance can
  differ from the row above it by more than that row's own amount, because an
  intervening transfer isn't shown. This is correct; leave a code comment
  explaining it.
- **Negative balances** render normally.
- **Empty account / no rows:** map is empty, no cells rendered (table already
  shows its empty state).

## Testing

- Unit test for `computeRunningBalances`: ordering by (date, id), opening-balance
  offset, running sum correctness, transfers included in the sum, and last-row
  value equals `openingBalance + Σ all amounts` (== currentBalance).
- Backend route test: with `accountId` passed, response rows carry a correct
  `runningBalance`; without `accountId`, rows omit it.

## Out of scope (YAGNI)

- A general column-visibility / column-manager UI.
- A stored per-row balance column in the DB.
- Multi-account running balance / interleaved-account display.
- SQL window-function computation (considered as Option B; JS accumulation chosen
  for readability and testability at this scale).
