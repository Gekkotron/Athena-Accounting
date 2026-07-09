# Transactions Running-Balance Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Solde" (running-balance) column to the Transactions table that shows the account balance after each transaction, appearing only when a single account is selected and the list is sorted by date.

**Architecture:** The running balance is computed on the backend, in JS, over each account's full chronological history (opening balance + cumulative sum by `date, id`), so it is correct regardless of pagination, sort order, or row filters. The list endpoint attaches an optional `runningBalance` string per row only when an `accountId` filter is present. The frontend conditionally renders the column when `accountId` is set and sort is `date`.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM, Postgres (backend); React, Tailwind, Vitest + @testing-library/react (frontend).

## Global Constraints

- Money is stored/returned as 2-dp numeric **strings** (e.g. `"-42.30"`); never emit floats. Sum in integer cents to avoid drift.
- Public-safe repo: no IPs, hostnames, or secrets in code or commits.
- Work directly on `main`; do not create branches; do not push (user pushes when ready).
- The running balance must include transfer rows (`transferGroupId` not null) even though the list hides them by default — the balance must reflect reality.
- Backend DB-gated tests run only under `RUN_DB_TESTS=1`; use `describe.skipIf(!RUN)`.
- `runningBalance` is computed **only** when the request carries `accountId`; otherwise rows omit it.

---

### Task 1: Pure `computeRunningBalances` helper

**Files:**
- Create: `backend/src/http/routes/transactions/running-balance.ts`
- Test: `backend/tests/running-balance.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `computeRunningBalances(rows: BalanceRow[], openingBalance: string): Map<number, string>` where `interface BalanceRow { id: number; amount: string }`. `rows` MUST already be ordered chronologically by `(date asc, id asc)`; the map value is `openingBalance + Σ amounts up to and including that row`, formatted as a 2-dp string.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/running-balance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeRunningBalances } from '../src/http/routes/transactions/running-balance.js';

describe('computeRunningBalances', () => {
  it('accumulates from the opening balance in chronological order', () => {
    const rows = [
      { id: 1, amount: '100.00' },
      { id: 2, amount: '-30.00' },
      { id: 3, amount: '-4.50' },
    ];
    const m = computeRunningBalances(rows, '50.00');
    expect(m.get(1)).toBe('150.00');
    expect(m.get(2)).toBe('120.00');
    expect(m.get(3)).toBe('115.50');
  });

  it('last row equals opening + sum of all amounts (== currentBalance)', () => {
    const rows = [
      { id: 1, amount: '1000.00' },
      { id: 2, amount: '-333.33' },
      { id: 3, amount: '-666.67' },
    ];
    const m = computeRunningBalances(rows, '0.00');
    expect(m.get(3)).toBe('0.00');
  });

  it('sums in cents to avoid float drift (0.10 + 0.20 === 0.30)', () => {
    const rows = [
      { id: 1, amount: '0.10' },
      { id: 2, amount: '0.20' },
    ];
    const m = computeRunningBalances(rows, '0.00');
    expect(m.get(2)).toBe('0.30');
  });

  it('handles negative balances and a zero opening', () => {
    const rows = [{ id: 7, amount: '-0.05' }];
    const m = computeRunningBalances(rows, '0.00');
    expect(m.get(7)).toBe('-0.05');
  });

  it('returns an empty map for no rows', () => {
    expect(computeRunningBalances([], '10.00').size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/running-balance.test.ts`
Expected: FAIL — cannot find module `../src/http/routes/transactions/running-balance.js` (helper not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/http/routes/transactions/running-balance.ts`:

```ts
export interface BalanceRow {
  id: number;
  amount: string;
}

/**
 * Running balance per transaction for a SINGLE account.
 *
 * `rows` MUST be the account's FULL history, already ordered chronologically
 * by (date asc, id asc) — the caller owns that ordering. Money is summed in
 * integer cents to avoid float drift, then formatted back to a 2-dp string.
 *
 * Returns Map<txId, balanceString>, where the balance is
 * `openingBalance + Σ amounts up to and including that row`.
 */
export function computeRunningBalances(
  rows: BalanceRow[],
  openingBalance: string,
): Map<number, string> {
  const toCents = (s: string): number => Math.round(Number(s) * 100);
  let acc = toCents(openingBalance);
  const out = new Map<number, string>();
  for (const r of rows) {
    acc += toCents(r.amount);
    out.set(r.id, (acc / 100).toFixed(2));
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/running-balance.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/transactions/running-balance.ts backend/tests/running-balance.test.ts
git commit -m "feat(transactions): pure running-balance accumulator"
```

---

### Task 2: Wire running balance into the list endpoint

**Files:**
- Modify: `backend/src/http/routes/transactions/index.ts` (imports near line 5; list handler around lines 205-223)
- Test: `backend/tests/transactions-route.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `computeRunningBalances` from Task 1; `accounts` table from `../../../db/schema.js`; existing `db`, `transactions`, `and`, `eq`, `asc`, `userId`, `q.accountId`.
- Produces: `GET /api/transactions` response rows gain an optional `runningBalance?: string` when `accountId` is in the query.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/transactions-route.test.ts`, inside the top-level `describe.skipIf(!RUN)('/api/transactions', …)` block (after the existing `describe('POST /api/transactions', …)`). `makeTx`, `app`, `cookie`, `accountAId` are already defined at the top of the file; the outer `afterEach` deletes all transactions between tests. Account `TxA` was created with `openingBalance: '0'`.

```ts
  describe('GET /api/transactions running balance', () => {
    it('attaches runningBalance per row when accountId is set', async () => {
      await makeTx({ accountId: accountAId, date: '2026-01-01', amount: '100.00', rawLabel: 'RB-A' });
      await makeTx({ accountId: accountAId, date: '2026-01-02', amount: '-30.00', rawLabel: 'RB-B' });
      await makeTx({ accountId: accountAId, date: '2026-01-03', amount: '-4.50', rawLabel: 'RB-C' });

      const res = await app.inject({
        method: 'GET',
        url: `/api/transactions?accountId=${accountAId}&sort=date&order=asc`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const txs = res.json().transactions as Array<{ rawLabel: string; runningBalance?: string }>;
      const byLabel = Object.fromEntries(txs.map((t) => [t.rawLabel, t.runningBalance]));
      expect(byLabel['RB-A']).toBe('100.00');
      expect(byLabel['RB-B']).toBe('70.00');
      expect(byLabel['RB-C']).toBe('65.50');
    });

    it('omits runningBalance when no accountId is given', async () => {
      await makeTx({ accountId: accountAId, date: '2026-01-01', amount: '100.00', rawLabel: 'RB-NOACC' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/transactions',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const txs = res.json().transactions as Array<{ runningBalance?: string }>;
      expect(txs.every((t) => t.runningBalance === undefined)).toBe(true);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/transactions-route.test.ts -t "running balance"`
Expected: FAIL — `runningBalance` is `undefined` on every row (endpoint doesn't compute it yet), so the `RB-A` assertion fails. (Requires Postgres up; if the DB is down, this test is skipped and cannot be verified locally — note that in the commit.)

- [ ] **Step 3: Add the import**

In `backend/src/http/routes/transactions/index.ts`, extend the schema import (currently `import { transactions, transactionSplits } from '../../../db/schema.js';` at line 5) to include `accounts`, and add the helper import below the existing local imports (after line 13):

```ts
import { transactions, transactionSplits, accounts } from '../../../db/schema.js';
```

```ts
import { computeRunningBalances } from './running-balance.js';
```

- [ ] **Step 4: Compute and attach the running balance**

In the `GET /api/transactions` handler, locate the block (around lines 205-223):

```ts
    const rows = await db
      .select()
      .from(transactions)
      .where(whereExpr)
      .orderBy(dir(orderCol), desc(transactions.id))
      .limit(q.limit)
      .offset(q.offset);

    const countRows = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(whereExpr);
    const total = countRows[0]?.total ?? 0;

    const hydrated = await hydrateSplits(rows);
    return {
      transactions: hydrated,
      pagination: { total, limit: q.limit, offset: q.offset },
    };
```

Replace it with (adds the balance computation between `total` and `hydrateSplits`):

```ts
    const rows = await db
      .select()
      .from(transactions)
      .where(whereExpr)
      .orderBy(dir(orderCol), desc(transactions.id))
      .limit(q.limit)
      .offset(q.offset);

    const countRows = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(whereExpr);
    const total = countRows[0]?.total ?? 0;

    // Running balance: only computed when the view is scoped to one account
    // (the only case the UI can display it). We accumulate over the account's
    // FULL chronological history — including transfer rows the list hides by
    // default — so pagination, sort order, and row filters never distort it.
    let balanceById: Map<number, string> | null = null;
    if (q.accountId) {
      const [acct] = await db
        .select({ openingBalance: accounts.openingBalance })
        .from(accounts)
        .where(and(eq(accounts.id, q.accountId), eq(accounts.userId, uid)));
      if (acct) {
        const history = await db
          .select({ id: transactions.id, amount: transactions.amount })
          .from(transactions)
          .where(and(eq(transactions.userId, uid), eq(transactions.accountId, q.accountId)))
          .orderBy(asc(transactions.date), asc(transactions.id));
        balanceById = computeRunningBalances(history, acct.openingBalance);
      }
    }

    const withBalance = balanceById
      ? rows.map((r) => ({ ...r, runningBalance: balanceById.get(r.id) }))
      : rows;

    const hydrated = await hydrateSplits(withBalance);
    return {
      transactions: hydrated,
      pagination: { total, limit: q.limit, offset: q.offset },
    };
```

Note: `balanceById.get(r.id)` inside the `.map` is safe because the `? :` guarantees `balanceById` is non-null there; if TypeScript's narrowing complains about the closure, use `balanceById!.get(r.id)`.

- [ ] **Step 5: Typecheck the backend**

Run: `cd backend && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the route test to verify it passes**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run tests/transactions-route.test.ts -t "running balance"`
Expected: PASS (2 tests). If Postgres is unavailable the suite is skipped — in that case state in the commit body that the DB-gated test was not run locally and rely on the Task 1 unit test plus typecheck.

- [ ] **Step 7: Commit**

```bash
git add backend/src/http/routes/transactions/index.ts backend/tests/transactions-route.test.ts
git commit -m "feat(transactions): attach runningBalance to the list endpoint when scoped to one account"
```

---

### Task 3: Frontend column (type + table header + row cell)

**Files:**
- Modify: `frontend/src/api/types.ts` (Transaction interface, lines 73-93)
- Modify: `frontend/src/pages/Transactions/TransactionsTable.tsx`
- Modify: `frontend/src/pages/Transactions/TransactionRow.tsx`
- Test: `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`

**Interfaces:**
- Consumes: `runningBalance?: string` on `Transaction` (from Task 2's response); `filters.accountId`, `filters.sort` (existing `Filters` type in `./index`); `formatAmount` from `../../lib/format`.
- Produces: `TransactionRow` gains a required `showBalance: boolean` prop; `TransactionsTable` computes `showBalance` and passes it down.

- [ ] **Step 1: Add the API type field**

In `frontend/src/api/types.ts`, add the field to the `Transaction` interface immediately before `splits: TransactionSplit[];` (line 92):

```ts
  // Account balance after this transaction (opening balance + cumulative sum
  // by date). Present only when the list is fetched with an accountId filter.
  runningBalance?: string;
```

- [ ] **Step 2: Write the failing render test**

Create `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransactionRow } from '../TransactionRow';
import type { Account, Transaction } from '../../../api/types';

const account: Account = {
  id: 1, name: 'Courant', type: 'checking', currency: 'EUR',
  openingBalance: '0', openingDate: '2025-01-01', displayOrder: 0,
} as Account;

const tx: Transaction = {
  id: 10, accountId: 1, date: '2026-01-02', amount: '-30.00',
  rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour', memo: null, notes: null,
  fitid: null, dedupKey: 'hash:x', categoryId: null, categorySource: 'auto',
  transferGroupId: null, sourceFileId: null, importedAt: '2026-01-02T00:00:00Z',
  runningBalance: '70.00', splits: [],
};

const noop = () => {};

function renderRow(showBalance: boolean) {
  return render(
    <table><tbody>
      <TransactionRow
        tx={tx} account={account} categories={[]} selected={false}
        expanded={false} showBalance={showBalance}
        onToggleExpanded={noop} onToggleSelect={noop}
        onUpdateCategory={noop} onUpdateNotes={noop} onEdit={noop} onDelete={noop}
      />
    </tbody></table>,
  );
}

describe('TransactionRow running-balance cell', () => {
  it('shows the formatted running balance when showBalance is true', () => {
    renderRow(true);
    // formatAmount emits the FR locale — the digit sequence 70,00 should appear.
    expect(screen.getByText(/70[.,]00/)).toBeInTheDocument();
  });

  it('does not render the running balance when showBalance is false', () => {
    renderRow(false);
    expect(screen.queryByText(/70[.,]00/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Transactions/__tests__/TransactionRow.test.tsx`
Expected: FAIL — `TransactionRow` has no `showBalance` prop and renders no balance cell (TypeScript error on the prop and/or the `70,00` text is absent).

- [ ] **Step 4: Add the cell to `TransactionRow`**

In `frontend/src/pages/Transactions/TransactionRow.tsx`:

4a. Add `showBalance` to the destructured props and its type. Change the destructuring (lines 4-28) to include `showBalance` — add it after `expanded` in both the params and the type block:

```tsx
  expanded,
  onToggleExpanded,
  showBalance,
}: {
```

and in the type block, after `onToggleExpanded: (id: number) => void;`:

```tsx
  onToggleExpanded: (id: number) => void;
  showBalance: boolean;
}) {
```

4b. Add the balance `<td>` in the main row immediately after the Montant cell (after lines 107-109, before the actions `<td>` at line 110):

```tsx
        {showBalance && (
          <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap tabular-nums text-ink-300">
            {tx.runningBalance != null ? formatAmount(tx.runningBalance, account?.currency ?? 'EUR') : '—'}
          </td>
        )}
```

4c. In the split sub-rows, add a matching empty cell after the split's Montant `<td>` (after lines 150-152, before the trailing `<td />` at line 153):

```tsx
              </td>
              {showBalance && <td />}
              <td />
```

(Insert `{showBalance && <td />}` between the split amount `</td>` and the final `<td />`.)

- [ ] **Step 5: Add the column to `TransactionsTable`**

In `frontend/src/pages/Transactions/TransactionsTable.tsx`:

5a. Compute `showBalance` at the top of the component body (after line 44, near the other derived values):

```tsx
  const showBalance = filters.accountId != null && filters.sort === 'date';
```

5b. Add the header `<th>` after the Montant `<Th>` (line 73), before the actions `<th>` (line 74):

```tsx
              <Th sort="amount" filters={filters} setFilters={setFilters} setOffset={setOffset} align="right">Montant</Th>
              {showBalance && <th className="px-4 py-3 label font-normal text-right">Solde</th>}
              <th className="px-4 py-3"></th>
```

5c. Bump the empty-state `colSpan` (line 80) to account for the extra column:

```tsx
                <td colSpan={showBalance ? 9 : 8} className="px-4 py-10 text-center text-ink-500 display-italic">
```

5d. Pass `showBalance` to each `TransactionRow` (add to the props around lines 86-99):

```tsx
                <TransactionRow
                  key={t.id}
                  tx={t}
                  account={accountById.get(t.accountId)}
                  categories={categories}
                  selected={selectedIds.has(t.id)}
                  expanded={expandedIds.has(t.id)}
                  showBalance={showBalance}
                  onToggleExpanded={onToggleExpanded}
                  onToggleSelect={onToggleSelect}
                  onUpdateCategory={onUpdateCategory}
                  onUpdateNotes={onUpdateNotes}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
```

- [ ] **Step 6: Run the render test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Transactions/__tests__/TransactionRow.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck + build the frontend**

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/pages/Transactions/TransactionsTable.tsx frontend/src/pages/Transactions/TransactionRow.tsx frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx
git commit -m "feat(transactions): render Solde running-balance column when scoped to one account + date sort"
```

---

### Task 4: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend + frontend unit suites**

Run: `cd backend && npx vitest run` then `cd frontend && npx vitest run`
Expected: all pass (DB-gated backend tests skip cleanly if Postgres is down).

- [ ] **Step 2: Drive the app (use the `/run` skill or the project run steps)**

- Start backend + frontend, log in.
- Go to Transactions with no account filter → confirm **no** "Solde" column.
- Filter to a single account, sort by Date → confirm the "Solde" column appears, right-aligned, and the top row (desc order) equals that account's current balance shown on the Accounts page.
- Switch sort to Montant → confirm the column disappears.
- Page to page 2 within the single-account view → confirm balances continue consistently (the last row of page 1 and first row of page 2 differ by exactly that row's amount, transfers aside).

Expected: behavior matches the spec. If anything is off, fix and re-run the relevant task's tests before claiming completion.
