# Transactions Checkpoint-Validate Checkbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a checkbox on the end-of-day transaction row (when the Solde column is shown) that creates/removes a balance checkpoint at that date equal to the row's running balance.

**Architecture:** Frontend-only. Reuses the existing `listCheckpoints`/`createCheckpoint`/`deleteCheckpoint` API client and endpoints. A pure `endOfDayRowIds` helper decides which rows get the checkbox (one per date, the day's chronologically-last transaction). The Transactions page fetches the account's checkpoints, indexes them by date, and toggles create/delete on change, invalidating the shared `['balance-checkpoints']` query so the chart and Accounts drawer stay in sync.

**Tech Stack:** React, TanStack Query, Tailwind, TypeScript, Vitest + @testing-library/react (jsdom).

## Global Constraints

- The checkbox shows under the SAME gate as the Solde column: `filters.accountId != null && filters.sort === 'date'`. Additionally only on the end-of-day row of each date, and only when that row has a `runningBalance`.
- One checkpoint per `(account, date)`; anchor to the day's chronologically-last transaction (max `id`); store its `runningBalance` as `expectedAmount`.
- Money values are 2-dp numeric STRINGS; pass `tx.runningBalance` through unchanged.
- On create/delete success, invalidate `queryKey: ['balance-checkpoints']` (prefix) — refreshes the drawer (`['balance-checkpoints', accountId]`) and dashboard chart (`['balance-checkpoints', chartScope]`).
- Plain checkbox — no drift/amber styling. Do not overwrite an existing checkpoint on check.
- Public-safe repo; work directly on `main`; do NOT branch or push.
- Frontend tests run under jsdom (no Postgres) and MUST actually pass. The app-driving check needs the runtime and is deferred (runtime stays off).

---

### Task 1: Pure `endOfDayRowIds` helper

**Files:**
- Create: `frontend/src/pages/Transactions/endOfDay.ts`
- Test: `frontend/src/pages/Transactions/__tests__/endOfDay.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `endOfDayRowIds(rows: { id: number; date: string }[]): Set<number>` — the set of row ids that are the max-`id` row for their `date` (the chronologically-last transaction of each day).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/Transactions/__tests__/endOfDay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { endOfDayRowIds } from '../endOfDay';

describe('endOfDayRowIds', () => {
  it('picks the max-id row per date', () => {
    const rows = [
      { id: 5, date: '2026-01-02' },
      { id: 9, date: '2026-01-02' },
      { id: 7, date: '2026-01-02' },
      { id: 3, date: '2026-01-01' },
    ];
    const s = endOfDayRowIds(rows);
    expect(s.has(9)).toBe(true); // end-of-day for 2026-01-02
    expect(s.has(3)).toBe(true); // sole row for 2026-01-01
    expect(s.has(5)).toBe(false);
    expect(s.has(7)).toBe(false);
    expect(s.size).toBe(2);
  });

  it('treats a single-transaction day as its own end-of-day', () => {
    expect(endOfDayRowIds([{ id: 1, date: '2026-03-03' }])).toEqual(new Set([1]));
  });

  it('returns an empty set for no rows', () => {
    expect(endOfDayRowIds([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Transactions/__tests__/endOfDay.test.ts`
Expected: FAIL — cannot resolve `../endOfDay` (not created yet).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/pages/Transactions/endOfDay.ts`:

```ts
// The "end-of-day" row for a date is that date's chronologically-last
// transaction — the one with the greatest id (running balance is computed by
// date,id ascending, so the max-id row of a date carries the end-of-day
// balance). A balance checkpoint is unique per (account, date), so only these
// rows get the "validate balance" checkbox.
//
// NOTE: computed over the currently-rendered page. A single date split across a
// page boundary can therefore resolve its end-of-day row per page; acceptable
// at 50 rows/page with few transactions per day.
export function endOfDayRowIds(rows: { id: number; date: string }[]): Set<number> {
  const maxByDate = new Map<string, number>();
  for (const r of rows) {
    const cur = maxByDate.get(r.date);
    if (cur === undefined || r.id > cur) maxByDate.set(r.date, r.id);
  }
  return new Set(maxByDate.values());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Transactions/__tests__/endOfDay.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions/endOfDay.ts frontend/src/pages/Transactions/__tests__/endOfDay.test.ts
git commit -m "feat(transactions): pure endOfDayRowIds helper for checkpoint anchoring"
```

---

### Task 2: Checkbox UI + data wiring (TransactionRow, TransactionsTable, index.tsx)

This is one cohesive task: the new props ripple `index → TransactionsTable → TransactionRow`, so doing them together keeps the build green. TDD via the TransactionRow render test.

**Files:**
- Modify: `frontend/src/pages/Transactions/TransactionRow.tsx`
- Modify: `frontend/src/pages/Transactions/TransactionsTable.tsx`
- Modify: `frontend/src/pages/Transactions/index.tsx`
- Test: `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx` (extend)

**Interfaces:**
- Consumes: `endOfDayRowIds` (Task 1); `BalanceCheckpoint` from `../../api/types`; `listCheckpoints`, `createCheckpoint`, `deleteCheckpoint` from `../../api/checkpoints`.
- Produces (prop contract):
  - `TransactionRow` gains required props: `isEndOfDay: boolean`, `checkpoint: BalanceCheckpoint | undefined`, `checkpointPending: boolean`, `onToggleCheckpoint: (tx: Transaction, checked: boolean) => void`.
  - `TransactionsTable` gains required props: `checkpointByDate: Map<string, BalanceCheckpoint>`, `pendingCheckpointDate: string | null`, `onToggleCheckpoint: (tx: Transaction, checked: boolean) => void`.

- [ ] **Step 1: Extend the render test (failing)**

In `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`:

1a. Add `BalanceCheckpoint` to the type import:

```tsx
import type { Transaction, Category, Account, BalanceCheckpoint } from '../../../api/types';
```

1b. Extend the `renderRow` overrides type and the `TransactionRow` props it passes. Replace the `overrides` parameter type and the defaults so the four new props are supplied:

```tsx
function renderRow(
  overrides: Partial<{
    tx: Transaction;
    selected: boolean;
    expanded: boolean;
    showBalance: boolean;
    onToggleExpanded: (id: number) => void;
    isEndOfDay: boolean;
    checkpoint: BalanceCheckpoint | undefined;
    checkpointPending: boolean;
    onToggleCheckpoint: (tx: Transaction, checked: boolean) => void;
  }> = {},
) {
  const tx = overrides.tx ?? t;
  const onUpdateCategory = vi.fn();
  const onUpdateNotes = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onToggleSelect = vi.fn();
  const onToggleExpanded = overrides.onToggleExpanded ?? (() => {});
  const onToggleCheckpoint = overrides.onToggleCheckpoint ?? vi.fn();
  const result = render(
    <table>
      <tbody>
        <TransactionRow
          tx={tx}
          account={acc}
          categories={cats}
          selected={overrides.selected ?? false}
          onToggleSelect={onToggleSelect}
          onUpdateCategory={onUpdateCategory}
          onUpdateNotes={onUpdateNotes}
          onEdit={onEdit}
          onDelete={onDelete}
          expanded={overrides.expanded ?? false}
          onToggleExpanded={onToggleExpanded}
          showBalance={overrides.showBalance ?? false}
          isEndOfDay={overrides.isEndOfDay ?? false}
          checkpoint={overrides.checkpoint}
          checkpointPending={overrides.checkpointPending ?? false}
          onToggleCheckpoint={onToggleCheckpoint}
        />
      </tbody>
    </table>,
  );
  return { onUpdateCategory, onUpdateNotes, onEdit, onDelete, onToggleSelect, onToggleCheckpoint, container: result.container };
}
```

1c. Append a new describe block at the end of the file:

```tsx
describe('TransactionRow checkpoint checkbox', () => {
  const txWithBalance: Transaction = { ...t, runningBalance: '70.00' };
  const cpLabel = /valider le solde/i;

  it('shows an unchecked checkbox on the end-of-day row when no checkpoint exists', () => {
    renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: true });
    const cb = screen.getByRole('checkbox', { name: cpLabel });
    expect(cb).not.toBeChecked();
  });

  it('shows a checked checkbox when a checkpoint exists for the date', () => {
    const checkpoint: BalanceCheckpoint = {
      id: 3, accountId: 1, checkpointDate: '2026-06-15', expectedAmount: '70.00', note: null, createdAt: '2026-06-15T00:00:00Z',
    };
    renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: true, checkpoint });
    expect(screen.getByRole('checkbox', { name: cpLabel })).toBeChecked();
  });

  it('calls onToggleCheckpoint(tx, true) when ticked', async () => {
    const user = userEvent.setup();
    const { onToggleCheckpoint } = renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: true });
    await user.click(screen.getByRole('checkbox', { name: cpLabel }));
    expect(onToggleCheckpoint).toHaveBeenCalledWith(txWithBalance, true);
  });

  it('is absent on a non-end-of-day row', () => {
    renderRow({ tx: txWithBalance, showBalance: true, isEndOfDay: false });
    expect(screen.queryByRole('checkbox', { name: cpLabel })).not.toBeInTheDocument();
  });

  it('is absent when the row has no running balance', () => {
    renderRow({ tx: t, showBalance: true, isEndOfDay: true }); // t has no runningBalance
    expect(screen.queryByRole('checkbox', { name: cpLabel })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Transactions/__tests__/TransactionRow.test.tsx`
Expected: FAIL — `TransactionRow` has no `isEndOfDay`/`checkpoint`/`checkpointPending`/`onToggleCheckpoint` props and renders no checkpoint checkbox (TS error and/or the checkbox is not found).

- [ ] **Step 3: Add the checkbox to `TransactionRow`**

In `frontend/src/pages/Transactions/TransactionRow.tsx`:

3a. Add `BalanceCheckpoint` to the type import (line 1):

```tsx
import type { Account, Category, Transaction, BalanceCheckpoint } from '../../api/types';
```

3b. Add the four props to the destructuring and its type block. After `showBalance,` in the params add:

```tsx
  showBalance,
  isEndOfDay,
  checkpoint,
  checkpointPending,
  onToggleCheckpoint,
}: {
```

and in the type block, after `showBalance: boolean;`:

```tsx
  showBalance: boolean;
  isEndOfDay: boolean;
  checkpoint: BalanceCheckpoint | undefined;
  checkpointPending: boolean;
  onToggleCheckpoint: (tx: Transaction, checked: boolean) => void;
}) {
```

3c. Replace the Solde `<td>` (currently lines 112-116) with a version that renders the checkbox before the amount on end-of-day rows:

```tsx
        {showBalance && (
          <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap tabular-nums text-ink-300">
            <span className="inline-flex items-center justify-end gap-2">
              {isEndOfDay && tx.runningBalance != null && (
                <input
                  type="checkbox"
                  className="align-middle accent-sage-300"
                  checked={checkpoint != null}
                  disabled={checkpointPending}
                  onChange={(e) => onToggleCheckpoint(tx, e.target.checked)}
                  aria-label={`Valider le solde du ${formatDate(tx.date)} comme point de contrôle`}
                  title="Valider ce solde comme point de contrôle"
                />
              )}
              <span>{tx.runningBalance != null ? formatAmount(tx.runningBalance, account?.currency ?? 'EUR') : '—'}</span>
            </span>
          </td>
        )}
```

(The split sub-rows are unchanged — they never carry the checkbox.)

- [ ] **Step 4: Thread the props through `TransactionsTable`**

In `frontend/src/pages/Transactions/TransactionsTable.tsx`:

4a. Add `BalanceCheckpoint` to the type import (line 2):

```tsx
import type { Account, Category, Transaction, BalanceCheckpoint } from '../../api/types';
import { endOfDayRowIds } from './endOfDay';
```

4b. Add the three new props to the destructuring (after `onToggleExpanded,`):

```tsx
  expandedIds,
  onToggleExpanded,
  checkpointByDate,
  pendingCheckpointDate,
  onToggleCheckpoint,
}: {
```

and to the props type block (after `onToggleExpanded: (id: number) => void;`):

```tsx
  onToggleExpanded: (id: number) => void;
  checkpointByDate: Map<string, BalanceCheckpoint>;
  pendingCheckpointDate: string | null;
  onToggleCheckpoint: (tx: Transaction, checked: boolean) => void;
}) {
```

4c. Compute the end-of-day set once, next to `showBalance` (after line 45):

```tsx
  const showBalance = filters.accountId != null && filters.sort === 'date';
  const endOfDayIds = showBalance ? endOfDayRowIds(transactions) : new Set<number>();
```

4d. Pass the per-row checkpoint props in the `TransactionRow` render (inside the `transactions.map`, alongside the existing props):

```tsx
                  showBalance={showBalance}
                  isEndOfDay={endOfDayIds.has(t.id)}
                  checkpoint={checkpointByDate.get(t.date)}
                  checkpointPending={pendingCheckpointDate === t.date}
                  onToggleCheckpoint={onToggleCheckpoint}
                  onToggleExpanded={onToggleExpanded}
```

- [ ] **Step 5: Wire the data + mutations in `index.tsx`**

In `frontend/src/pages/Transactions/index.tsx`:

5a. Extend the type import and add the checkpoints API import (near the other imports, after `parseAmountQuery`):

```tsx
import type { Account, Category, Transaction, BalanceCheckpoint } from '../../api/types';
```
```tsx
import { listCheckpoints, createCheckpoint, deleteCheckpoint } from '../../api/checkpoints';
```

5b. Add the pending-date state next to the other `useState` hooks (after the `bulkDeleteError` state line):

```tsx
  const [pendingCheckpointDate, setPendingCheckpointDate] = useState<string | null>(null);
```

5c. Add the checkpoints query immediately after the `txQ` query:

```tsx
  const checkpointsQ = useQuery({
    queryKey: ['balance-checkpoints', filters.accountId],
    queryFn: () => listCheckpoints(filters.accountId!),
    enabled: filters.accountId != null,
  });
```

5d. Add the create/delete mutations after the `bulkDelete` mutation:

```tsx
  const createCheckpointM = useMutation({
    mutationFn: (vars: { accountId: number; date: string; amount: string }) =>
      createCheckpoint(vars.accountId, {
        checkpointDate: vars.date,
        expectedAmount: vars.amount,
        note: null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['balance-checkpoints'] }),
    onSettled: () => setPendingCheckpointDate(null),
  });

  const removeCheckpointM = useMutation({
    mutationFn: (vars: { accountId: number; cpId: number }) =>
      deleteCheckpoint(vars.accountId, vars.cpId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['balance-checkpoints'] }),
    onSettled: () => setPendingCheckpointDate(null),
  });
```

5e. After `const accountById = new Map(...)`, build the date→checkpoint map and the toggle handler:

```tsx
  const checkpointByDate = new Map(
    (checkpointsQ.data?.checkpoints ?? []).map((c) => [c.checkpointDate, c] as const),
  );

  const onToggleCheckpoint = (tx: Transaction, checked: boolean) => {
    const accId = filters.accountId;
    if (accId == null || tx.runningBalance == null) return;
    setPendingCheckpointDate(tx.date);
    if (checked) {
      createCheckpointM.mutate({ accountId: accId, date: tx.date, amount: tx.runningBalance });
    } else {
      const cp = checkpointByDate.get(tx.date);
      if (cp) removeCheckpointM.mutate({ accountId: accId, cpId: cp.id });
      else setPendingCheckpointDate(null);
    }
  };
```

5f. Pass the three new props into `<TransactionsTable ... />` (alongside the existing props, e.g. right after `accountById={accountById}`):

```tsx
        accountById={accountById}
        checkpointByDate={checkpointByDate}
        pendingCheckpointDate={pendingCheckpointDate}
        onToggleCheckpoint={onToggleCheckpoint}
```

- [ ] **Step 6: Run the render test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Transactions/__tests__/TransactionRow.test.tsx`
Expected: PASS (all prior tests + the 5 new checkpoint tests).

- [ ] **Step 7: Typecheck the frontend**

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Transactions/TransactionRow.tsx frontend/src/pages/Transactions/TransactionsTable.tsx frontend/src/pages/Transactions/index.tsx frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx
git commit -m "feat(transactions): validate-balance checkbox creates/removes a checkpoint"
```

---

### Task 3: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all pass (previous total + the new endOfDay and checkpoint-checkbox tests).

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: clean.

- [ ] **Step 3: Drive the app (deferred — needs the runtime)**

When the stack is up (e.g. on the Geekom):
- Transactions filtered to one account, sorted by Date → each day's last row shows a checkbox in the Solde cell.
- Tick it → a checkpoint appears at that date on the balance chart (green/matched) and in the Accounts checkpoints drawer, with `expectedAmount` = that row's Solde.
- Untick → the checkpoint disappears from chart and drawer.
- Switch sort to Montant or clear the account filter → the Solde column and the checkboxes disappear.
- A day with several transactions shows exactly one checkbox (on the last row); ticking stores the end-of-day balance.

Expected: matches the spec. If anything is off, fix and re-run Task 1/2 tests before claiming completion.
