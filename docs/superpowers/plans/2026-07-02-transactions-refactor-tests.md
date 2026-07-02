# Transactions.tsx Refactor + Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `frontend/src/pages/Transactions.tsx` (746 lines) into `pages/Transactions/` (6 focused files), guarded by 8 characterization tests written first + ~18 unit tests written after. Third iteration of the interleave.

**Architecture:** Same three-scope shape used for Accounts and Rules: characterize user-visible behavior FIRST, split into leaf-first extractions with the characterization suite as safety net, unit-test the extracted pieces. Frontend test harness (Vitest + RTL + jsdom) unchanged.

**Tech Stack:** Vitest 2 + `@testing-library/react` + `@testing-library/user-event` + `jsdom` (frontend); React 18 + Vite + TanStack Query v5.

**Spec:** `docs/superpowers/specs/2026-07-02-transactions-refactor-tests-design.md`

## Global Constraints

- Cache keys must NOT change: `['transactions']`, `['accounts']`, `['categories']`. All three are consumed by other pages (Dashboard reads accounts/transactions; Categories/Tri read categories).
- Every characterization test written in Task 1 must remain green through Tasks 2–7 (split). No skip, no update, no `.only`.
- Testing Library idioms: `getByRole` > `getByTestId`; `userEvent.setup()` > `fireEvent` EXCEPT `type="date"` inputs (jsdom limitation — `fireEvent.change(input, { target: { value: 'YYYY-MM-DD' } })`).
- Search-debounce logic stays in `index.tsx`. Task 1's Test #3 uses Vitest fake timers (`vi.useFakeTimers()`, `vi.advanceTimersByTime(300)`) to fast-forward deterministically.
- Behavior-preservation guardrails from earlier iterations:
  - If a subcomponent needs to signal reset on parent success, use a **monotonic counter** bumped in `onSuccess`, not the returned `data` value. Avoids the primitive-equality edge case flagged in Rules deferrals.
  - Any callback reading state from closure at submit-time passes the draft explicitly (`callback(id, draft)`) with an inline comment explaining why the parameter isn't redundant.
- Public-safe: no PII, IPs, hostnames.
- Commit convention: `<type>(<scope>): <short-summary>` — `test(transactions)`, `refactor(transactions)`, `docs(status)`. Every commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Test files under a `__tests__/` subdirectory next to the code.

---

## Task 1 — Characterization tests on Transactions.tsx

**Files:**
- Create: `frontend/src/pages/__tests__/Transactions.test.tsx`

**Interfaces:**
- Consumes: existing frontend test harness; unchanged `frontend/src/pages/Transactions.tsx`.
- Produces: eight green tests. Tasks 2–7 rely on them to stay green through the split.

- [ ] **Step 1: Read Transactions.tsx to confirm actual DOM strings**

Before writing tests, read `frontend/src/pages/Transactions.tsx`. Note exact strings for:
- Page title / section headers.
- Filter labels (or `aria-label` fallbacks) for account, category, date-from, date-to, search.
- View toggle / advanced-filters toggle button text.
- Table column headers.
- Pagination button labels (Next / Prev or Suivant / Précédent).
- ConfirmDialog labels for delete.
- "Add transaction" button text.
- Empty-state copy.

The tests below use regex placeholders — tighten each to actual DOM before finalizing.

- [ ] **Step 2: Create test file skeleton**

Create `frontend/src/pages/__tests__/Transactions.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Transactions } from '../Transactions';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function renderTransactions() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Transactions />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Field-by-label helper for forms whose labels lack for/id association.
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control found near label ${String(labelText)}`);
  return control as HTMLElement;
}

beforeEach(() => {
  apiMock.mockReset();
});

const acc = (id: number, name: string, currency = 'EUR') => ({
  id, name, type: 'checking', currency,
  openingBalance: '0.00', openingDate: '2025-01-01',
});

const cat = (id: number, name: string) => ({
  id, name, kind: 'expense' as const,
  color: null, parentId: null, isDefault: false,
});

const tx = (id: number, extras: Partial<any> = {}) => ({
  id, accountId: 1, date: '2026-06-15', amount: '-42.30',
  rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour',
  memo: null, notes: null, fitid: null,
  dedupKey: `dk-${id}`, categoryId: null, categorySource: 'auto',
  transferGroupId: null, sourceFileId: null,
  importedAt: '2026-06-15T00:00:00Z',
  ...extras,
});

describe('Transactions page (characterization)', () => {
  // Tests below.
});
```

- [ ] **Step 3: Add Test 1 — Renders list**

```tsx
it('renders the transaction list with pagination controls', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
    if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
    if (path.startsWith('/api/transactions')) {
      return { transactions: [tx(1), tx(2)], total: 2 };
    }
    throw new Error(`unexpected: ${path}`);
  });

  renderTransactions();

  expect(await screen.findByText('CB CARREFOUR')).toBeInTheDocument();
  // Two rows visible.
  const rows = screen.getAllByText('CB CARREFOUR');
  expect(rows.length).toBeGreaterThanOrEqual(1);
});
```

Adjust `screen.getAllByText` to whatever DOM strategy identifies rows (e.g., `screen.getAllByRole('row')` if the table uses semantic table markup).

- [ ] **Step 4: Add Test 2 — Filter by account**

```tsx
it('refetches when the account filter changes', async () => {
  const calls: string[] = [];
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'A'), acc(2, 'B')] };
    if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
    if (path.startsWith('/api/transactions')) {
      calls.push(path);
      return { transactions: [], total: 0 };
    }
    throw new Error(`unexpected: ${path}`);
  });

  const user = userEvent.setup();
  renderTransactions();
  await screen.findByText(/aucune transaction|no transactions/i);

  // Pick account "B" — adjust label/regex to actual DOM.
  const accountSelect = fieldFor(/compte|account/i);
  await user.selectOptions(accountSelect, '2');

  await waitFor(() => {
    expect(calls.some((p) => p.includes('accountId=2'))).toBe(true);
  });
});
```

- [ ] **Step 5: Add Test 3 — Search debounce**

```tsx
it('debounces the search input before refetching', async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
    if (path === '/api/categories') return { categories: [] };
    if (path.startsWith('/api/transactions')) {
      calls.push(path);
      return { transactions: [], total: 0 };
    }
    throw new Error(`unexpected: ${path}`);
  });

  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderTransactions();

  // Wait for the initial fetch — advance timers to let all initial effects fire.
  await vi.runAllTimersAsync();

  const initialCallCount = calls.length;
  const searchInput = fieldFor(/rechercher|search/i);
  await user.type(searchInput, 'carrefour');

  // Before advancing, no new call yet.
  expect(calls.length).toBe(initialCallCount);

  // Advance past the debounce window (usually 300ms in this codebase; adjust).
  vi.advanceTimersByTime(500);
  await vi.runAllTimersAsync();

  await waitFor(() => {
    expect(calls.some((p) => p.includes('search=carrefour'))).toBe(true);
  });

  vi.useRealTimers();
});
```

If the debounce interval in `Transactions.tsx` is not 300ms, adjust `vi.advanceTimersByTime` accordingly. Read the source to confirm.

- [ ] **Step 6: Add Test 4 — Pagination**

```tsx
it('advances offset when Next is clicked', async () => {
  const calls: string[] = [];
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
    if (path === '/api/categories') return { categories: [] };
    if (path.startsWith('/api/transactions')) {
      calls.push(path);
      return {
        transactions: Array.from({ length: 50 }, (_, i) => tx(i + 1)),
        total: 120,
      };
    }
    throw new Error(`unexpected: ${path}`);
  });

  const user = userEvent.setup();
  renderTransactions();
  await screen.findByText('CB CARREFOUR');

  // Click next — button label per DOM (adjust regex).
  await user.click(screen.getByRole('button', { name: /suivant|next/i }));

  await waitFor(() => {
    expect(calls.some((p) => p.includes('offset=50'))).toBe(true);
  });
});
```

- [ ] **Step 7: Add Test 5 — Inline category edit**

```tsx
it('inline-edits a transaction category via PUT with only the changed field', async () => {
  const original = tx(1, { categoryId: null });
  const updated = { ...original, categoryId: 10 };
  const putBodies: any[] = [];
  let edited = false;
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
    if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
    if (path.startsWith('/api/transactions') && !path.includes('/api/transactions/')) {
      return { transactions: [edited ? updated : original], total: 1 };
    }
    if (path === '/api/transactions/1' && init?.method === 'PATCH') {
      putBodies.push(init.json);
      edited = true;
      return { transaction: updated };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderTransactions();
  await screen.findByText('CB CARREFOUR');

  // Click the category cell (starts empty / "—" or similar), then pick Courses.
  // The exact interaction depends on the DOM — adjust to the actual affordance.
  // Common pattern: click the cell → select renders → pick option.
  // ...
  // await user.click(within(row).getByRole('button', { name: /catégorie/i }));
  // await user.selectOptions(within(row).getByRole('combobox'), '10');

  await waitFor(() => expect(putBodies).toHaveLength(1));
  expect(putBodies[0]).toEqual({ categoryId: 10 });
});
```

The test body's `//` comments mark where the DOM-specific interaction goes. Read `Transactions.tsx` to determine the actual inline-edit affordance (button? select-on-click? modal?) and translate the assertion. The core invariant — `putBodies[0]` is a single-field patch — is the safety net.

Note: the actual endpoint may be `PATCH /api/transactions/:id` (per project convention in `backend/src/http/routes/transactions.ts` which uses PATCH for inline edits). Adjust `init?.method === 'PATCH'` to whatever the actual API wrapper sends.

- [ ] **Step 8: Add Test 6 — Inline notes edit**

Same structure as Test 5 but for the notes cell. Assert `putBodies[0] === { notes: 'new note' }` — only the changed field.

```tsx
it('inline-edits notes via PUT with only the changed field', async () => {
  const original = tx(1);
  const updated = { ...original, notes: 'new note' };
  const putBodies: any[] = [];
  let edited = false;
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
    if (path === '/api/categories') return { categories: [] };
    if (path.startsWith('/api/transactions') && !path.includes('/api/transactions/')) {
      return { transactions: [edited ? updated : original], total: 1 };
    }
    if (path === '/api/transactions/1' && init?.method === 'PATCH') {
      putBodies.push(init.json);
      edited = true;
      return { transaction: updated };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderTransactions();
  await screen.findByText('CB CARREFOUR');

  // Trigger the notes-cell inline edit. Actual UX may be click-to-edit,
  // hover-then-icon, or via the row-open modal. Adapt.
  // ...

  await waitFor(() => expect(putBodies).toHaveLength(1));
  expect(putBodies[0]).toEqual({ notes: 'new note' });
});
```

- [ ] **Step 9: Add Test 7 — Delete with confirm**

```tsx
it('deletes a transaction after confirming', async () => {
  let deleted = false;
  apiMock.mockImplementation(async (path: string, init?: any) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
    if (path === '/api/categories') return { categories: [] };
    if (path.startsWith('/api/transactions') && !path.includes('/api/transactions/')) {
      return { transactions: deleted ? [] : [tx(1)], total: deleted ? 0 : 1 };
    }
    if (path === '/api/transactions/1' && init?.method === 'DELETE') {
      deleted = true;
      return { ok: true };
    }
    throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
  });

  const user = userEvent.setup();
  renderTransactions();
  await screen.findByText('CB CARREFOUR');

  // Trigger delete affordance on the row. May be a ✕ / trash icon.
  await user.click(screen.getByRole('button', { name: /supprimer|delete/i }));

  // ConfirmDialog appears; click destructive confirm.
  await user.click(await screen.findByRole('button', { name: /supprimer|confirm/i }));

  await waitFor(() => expect(screen.queryByText('CB CARREFOUR')).not.toBeInTheDocument());
});
```

- [ ] **Step 10: Add Test 8 — Open modal**

```tsx
it('opens the transaction modal when the add-transaction control is clicked', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
    if (path === '/api/categories') return { categories: [] };
    if (path.startsWith('/api/transactions')) return { transactions: [], total: 0 };
    throw new Error(`unexpected: ${path}`);
  });

  const user = userEvent.setup();
  renderTransactions();
  await screen.findByText(/aucune transaction|no transactions/i);

  // Adjust to the actual button text ("Ajouter", "Nouvelle transaction", "+" etc.).
  await user.click(screen.getByRole('button', { name: /ajouter|nouvelle|add/i }));

  // Assert the modal is visible — a distinctive modal-only string, e.g.
  // "Nouvelle transaction" as a heading, or the modal's form's cancel button.
  expect(await screen.findByRole('heading', { name: /nouvelle transaction|new transaction/i })).toBeInTheDocument();
});
```

If the modal is triggered by clicking a row (rather than a dedicated add button), rewrite this test as a click-on-row-opens-detail-modal instead. Match reality.

- [ ] **Step 11: Run the suite**

```bash
cd frontend && npx vitest run src/pages/__tests__/Transactions.test.tsx
```
Expected: `8 passed`. If a test fails on a label/role mismatch, adjust the query — do NOT modify `Transactions.tsx`. If the debounce test's timing is off, adjust `vi.advanceTimersByTime` to match the actual debounce interval.

- [ ] **Step 12: TSC**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: 0 errors.

- [ ] **Step 13: Commit**

```bash
git add frontend/src/pages/__tests__/Transactions.test.tsx
git commit -m "$(cat <<'EOF'
test(transactions): characterization suite for pages/Transactions.tsx

Eight end-to-end component tests locking in today's behavior via
mocked api client: list render, account filter, search debounce
(fake timers), pagination, inline category edit, inline notes edit,
delete + confirm, modal open.

These are the safety net for the pages/Transactions/ split — every
test must remain green after every extraction with zero test-code
changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Move `Transactions.tsx` to `Transactions/index.tsx`

**Files:**
- Delete: `frontend/src/pages/Transactions.tsx`
- Create: `frontend/src/pages/Transactions/index.tsx`

**Interfaces:**
- Consumes: nothing new. `App.tsx`'s `import { Transactions } from './pages/Transactions'` resolves to `./pages/Transactions/index.tsx` via directory-index resolution.
- Produces: file location that Tasks 3–7 extract from.

- [ ] **Step 1: Move**

```bash
mkdir -p frontend/src/pages/Transactions
git mv frontend/src/pages/Transactions.tsx frontend/src/pages/Transactions/index.tsx
```

- [ ] **Step 2: Fix relative imports**

In the moved file, every `from '../` becomes `from '../../`. Sanity-check:
```bash
grep -n "from '\\.\\./" frontend/src/pages/Transactions/index.tsx
```
Adjust each. Also confirm no same-directory `from './` imports exist:
```bash
grep -n "from '\\./" frontend/src/pages/Transactions/index.tsx
```
Expected: no matches.

- [ ] **Step 3: TSC + characterization tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Transactions.test.tsx
```
Expected: 0 errors, `8 passed`.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/pages
git commit -m "$(cat <<'EOF'
refactor(transactions): move pages/Transactions.tsx to pages/Transactions/index.tsx

Pure relocation with adjusted relative imports. No behavior change;
characterization tests still green. Prepares for extraction of Th,
TransactionRow, TransactionsTable, FiltersBar, and TransactionModal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Extract `Th`

**Files:**
- Create: `frontend/src/pages/Transactions/Th.tsx`
- Modify: `frontend/src/pages/Transactions/index.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function Th({ label, field, activeField?, direction?, onSort }: { ... }): JSX.Element;` (exact shape per actual inline definition).

- [ ] **Step 1: Read inline `Th`**

In `frontend/src/pages/Transactions/index.tsx`, locate `function Th({ ... })`. Note its exact prop shape.

- [ ] **Step 2: Create `Th.tsx`**

Create `frontend/src/pages/Transactions/Th.tsx`:

```tsx
// (paste the Th body verbatim from index.tsx; change `function Th` to `export function Th`)
// Add any imports Th needs (React types, style utilities).
```

- [ ] **Step 3: Update `index.tsx`**

Delete the inline `Th`. Add `import { Th } from './Th';`. JSX call sites `<Th ... />` stay unchanged.

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Transactions.test.tsx
```
Expected: 0 errors, `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions/Th.tsx frontend/src/pages/Transactions/index.tsx
git commit -m "$(cat <<'EOF'
refactor(transactions): extract Th (sortable column header)

Pure code motion. Leaf component with no cross-dependencies.
Characterization tests still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Extract `TransactionRow`

**Files:**
- Create: `frontend/src/pages/Transactions/TransactionRow.tsx`
- Modify: `frontend/src/pages/Transactions/index.tsx`

**Interfaces:**
- Consumes: `Transaction`, `Account`, `Category` types from `../../api/types`.
- Produces:
  ```ts
  export function TransactionRow({
    tx, categories, accounts,
    onUpdateCategory, onUpdateNotes, onDelete,
  }: {
    tx: Transaction;
    categories: Category[];
    accounts: Account[];
    onUpdateCategory: (id: number, patch: { categoryId: number | null }) => void;
    onUpdateNotes: (id: number, patch: { notes: string | null }) => void;
    onDelete: (tx: Transaction) => void;
  }): JSX.Element;
  ```

Adjust the actual prop shape to match today's inline row (read `index.tsx` first). Note that in the current inline code, the row's cells may directly call the mutation objects (`updateCategory.mutate(...)`) rather than callback props — if so, decide whether to pass mutation objects (like Rules did) or callback props (like Accounts did). Prefer callback props for testability; the parent wraps `updateCategory.mutate` in an arrow.

- [ ] **Step 1: Read inline row rendering**

In `frontend/src/pages/Transactions/index.tsx`, locate the JSX block that renders a single transaction row (inside the table's rows iteration). Note:
- Which cells it renders and in what order.
- Which cells are inline-editable.
- What state is local (edit mode per cell?) vs. parent (mutation state).
- How the mutations are invoked.

If today's row is not an extracted subcomponent (i.e., it's a JSX fragment inside the table's `.map(...)`), lift it as `TransactionRow` with the interface above. Preserve exact cell layout.

- [ ] **Step 2: Create `TransactionRow.tsx`**

Create `frontend/src/pages/Transactions/TransactionRow.tsx`. Include:
- `useState` for local edit-cell state (which cell is currently in edit mode).
- Import types from `../../api/types`.
- Import `formatAmount` / `formatDate` from `../../lib/format` if used.

If the parent's inline row directly reads mutation objects (e.g. `updateCategory.mutate`), refactor to accept callback props (`onUpdateCategory`, `onUpdateNotes`, `onDelete`) — this cleanly decouples the row from React Query and makes it unit-testable without a `QueryClient` wrapper.

- [ ] **Step 3: Update `index.tsx`**

Replace the inline row-JSX with `<TransactionRow tx={tx} categories={categories} accounts={accounts} onUpdateCategory={(id, patch) => updateCategory.mutate({ id, patch })} onUpdateNotes={(id, patch) => updateNotes.mutate({ id, patch })} onDelete={(tx) => setDeletingTx(tx)} />` (or equivalent — match the actual mutation shapes).

Add `import { TransactionRow } from './TransactionRow';`.

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Transactions.test.tsx
```
Expected: 0 errors, `8 passed`. Tests 5 (category edit) and 6 (notes edit) exercise this — must stay green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions/TransactionRow.tsx frontend/src/pages/Transactions/index.tsx
git commit -m "$(cat <<'EOF'
refactor(transactions): extract TransactionRow

TransactionRow now owns its inline-edit state (which cell is being
edited) locally. Mutations flow through callback props from the
parent, decoupling row rendering from React Query.

Characterization tests still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Extract `TransactionsTable`

**Files:**
- Create: `frontend/src/pages/Transactions/TransactionsTable.tsx`
- Modify: `frontend/src/pages/Transactions/index.tsx`

**Interfaces:**
- Consumes: `Th` and `TransactionRow` from siblings.
- Produces:
  ```ts
  export function TransactionsTable({
    transactions, categories, accounts,
    sortField, sortDir, onSort,
    onUpdateCategory, onUpdateNotes, onDelete,
  }: {
    transactions: Transaction[];
    categories: Category[];
    accounts: Account[];
    sortField: string;
    sortDir: 'asc' | 'desc';
    onSort: (field: string) => void;
    onUpdateCategory: (id: number, patch: { categoryId: number | null }) => void;
    onUpdateNotes: (id: number, patch: { notes: string | null }) => void;
    onDelete: (tx: Transaction) => void;
  }): JSX.Element;
  ```

Actual props may differ (e.g., no sort feature — depends on today's code). Read and adapt.

- [ ] **Step 1: Read the table JSX**

In `frontend/src/pages/Transactions/index.tsx`, locate the `<table>` (or grid wrapper) that holds the transactions. It uses `<Th>` for headers and `<TransactionRow>` for rows.

- [ ] **Step 2: Create `TransactionsTable.tsx`**

Create the file with the imports:

```tsx
import { Th } from './Th';
import { TransactionRow } from './TransactionRow';
import type { Transaction, Category, Account } from '../../api/types';

export function TransactionsTable(props: /* see Interfaces */) {
  // Paste the table JSX from index.tsx; wire callbacks through props.
  // Include the empty-state fallback (an "Aucune transaction" row / message).
}
```

- [ ] **Step 3: Update `index.tsx`**

Delete the inline table JSX. Add `import { TransactionsTable } from './TransactionsTable';`. Render:

```tsx
<TransactionsTable
  transactions={txQ.data?.transactions ?? []}
  categories={categoriesQ.data?.categories ?? []}
  accounts={accountsQ.data?.accounts ?? []}
  sortField={filters.sort ?? 'date'}
  sortDir={filters.sortDir ?? 'desc'}
  onSort={(field) => setFilters((f) => ({ ...f, sort: field, sortDir: f.sort === field && f.sortDir === 'desc' ? 'asc' : 'desc' }))}
  onUpdateCategory={(id, patch) => updateCategory.mutate({ id, patch })}
  onUpdateNotes={(id, patch) => updateNotes.mutate({ id, patch })}
  onDelete={(tx) => setDeletingTx(tx)}
/>
```

Adjust the wiring to match actual state names in `index.tsx`.

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Transactions.test.tsx
```
Expected: 0 errors, `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions/TransactionsTable.tsx frontend/src/pages/Transactions/index.tsx
git commit -m "$(cat <<'EOF'
refactor(transactions): extract TransactionsTable

Table shell now delegates to Th + TransactionRow. Sort state and
mutations flow through props from index.tsx. Characterization tests
still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Extract `FiltersBar`

**Files:**
- Create: `frontend/src/pages/Transactions/FiltersBar.tsx`
- Modify: `frontend/src/pages/Transactions/index.tsx`

**Interfaces:**
- Consumes: `Account`, `Category` types.
- Produces:
  ```ts
  export function FiltersBar({
    filters, searchInput,
    accounts, categories,
    showAdvanced, onToggleAdvanced,
    onFilterChange, onSearchInputChange,
  }: {
    filters: Filters;
    searchInput: string;
    accounts: Account[];
    categories: Category[];
    showAdvanced: boolean;
    onToggleAdvanced: () => void;
    onFilterChange: (patch: Partial<Filters>) => void;
    onSearchInputChange: (value: string) => void;
  }): JSX.Element;
  ```

Where `Filters` is whatever local type `index.tsx` defines for its filter state. If today's file doesn't have a `Filters` interface exported, define it in the new file and re-export from `index.tsx`.

Search-debounce logic (the `useEffect` watching `searchInput` and updating `filters.search`) STAYS in `index.tsx` — do not move it into `FiltersBar`.

- [ ] **Step 1: Read the filter form JSX**

In `frontend/src/pages/Transactions/index.tsx`, locate the block that renders the filter inputs (typically at the top of the page render, before the table).

- [ ] **Step 2: Create `FiltersBar.tsx`**

Create the file with the interface above. Move the filter-form JSX in. Wire the inputs to `filters.*` and callbacks.

- [ ] **Step 3: Update `index.tsx`**

Replace the inline filter JSX with:

```tsx
<FiltersBar
  filters={filters}
  searchInput={searchInput}
  accounts={accountsQ.data?.accounts ?? []}
  categories={categoriesQ.data?.categories ?? []}
  showAdvanced={showFilters}
  onToggleAdvanced={() => setShowFilters((s) => !s)}
  onFilterChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
  onSearchInputChange={setSearchInput}
/>
```

Add `import { FiltersBar } from './FiltersBar';`. Adjust state names to reality.

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Transactions.test.tsx
```
Expected: 0 errors, `8 passed`. Tests 2 (account filter) and 3 (search debounce) exercise this — must stay green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions/FiltersBar.tsx frontend/src/pages/Transactions/index.tsx
git commit -m "$(cat <<'EOF'
refactor(transactions): extract FiltersBar

FiltersBar owns the filter form (account / category / date-from /
date-to / search) and delegates state changes via onFilterChange +
onSearchInputChange callbacks. Search-debounce logic stays in
index.tsx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Extract `TransactionModal`

**Files:**
- Create: `frontend/src/pages/Transactions/TransactionModal.tsx`
- Modify: `frontend/src/pages/Transactions/index.tsx`

**Interfaces:**
- Consumes: `Transaction`, `Account`, `Category` types; `useMutation` for the create.
- Produces:
  ```ts
  export function TransactionModal({
    open, initialTx, accounts, categories,
    onClose, onCreated,
  }: {
    open: boolean;
    initialTx: Transaction | null;    // null for create, a tx for edit
    accounts: Account[];
    categories: Category[];
    onClose: () => void;
    onCreated?: () => void;
  }): JSX.Element | null;
  ```

Adjust to actual props. TransactionModal is already a named `function TransactionModal({...})` in the inline code (line 414 per exploration), so its signature is already defined — copy it verbatim.

- [ ] **Step 1: Read inline TransactionModal**

In `frontend/src/pages/Transactions/index.tsx`, locate `function TransactionModal({ ... })`. Note its exact prop shape, its internal state, its mutation logic.

- [ ] **Step 2: Create `TransactionModal.tsx`**

Copy the inline function verbatim into the new file. Add necessary imports (React hooks, TanStack Query, type imports, formatting helpers). Change `function TransactionModal` to `export function TransactionModal`.

- [ ] **Step 3: Update `index.tsx`**

Delete the inline function body. Add `import { TransactionModal } from './TransactionModal';`. The JSX call `<TransactionModal ... />` stays unchanged.

- [ ] **Step 4: TSC + tests**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run src/pages/__tests__/Transactions.test.tsx
```
Expected: 0 errors, `8 passed`. Test 8 (open modal) exercises this — must stay green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions/TransactionModal.tsx frontend/src/pages/Transactions/index.tsx
git commit -m "$(cat <<'EOF'
refactor(transactions): extract TransactionModal

Pure code motion. Modal owns its own form state and create mutation.
Characterization Test #8 still green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Unit tests: `Th` + `TransactionRow`

**Files:**
- Create: `frontend/src/pages/Transactions/__tests__/Th.test.tsx`
- Create: `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`

**Interfaces:**
- Consumes: `Th` (Task 3), `TransactionRow` (Task 4).
- Produces: two unit-test files.

- [ ] **Step 1: Write `Th.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Th } from '../Th';

describe('Th', () => {
  it('renders its label', () => {
    render(<table><thead><tr><Th label="Date" field="date" onSort={() => {}} /></tr></thead></table>);
    expect(screen.getByText('Date')).toBeInTheDocument();
  });

  it('fires onSort(field) when clicked', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(<table><thead><tr><Th label="Date" field="date" onSort={onSort} /></tr></thead></table>);
    await user.click(screen.getByText('Date'));
    expect(onSort).toHaveBeenCalledWith('date');
  });

  it('renders a sort indicator when active', () => {
    render(<table><thead><tr><Th label="Date" field="date" activeField="date" direction="desc" onSort={() => {}} /></tr></thead></table>);
    // Assert whatever visual indicator Th uses (an SVG, arrow character, aria-sort attribute, etc.).
    // Read Th.tsx to know the actual indicator; the assertion below is a placeholder.
    // expect(screen.getByText('↓')).toBeInTheDocument();
    // OR
    // expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending');
  });
});
```

Adjust the third test to whatever Th actually renders for the "active-sort" state.

- [ ] **Step 2: Write `TransactionRow.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionRow } from '../TransactionRow';
import type { Transaction, Category, Account } from '../../../api/types';

const acc: Account = { id: 1, name: 'Compte', type: 'checking', currency: 'EUR',
  openingBalance: '0.00', openingDate: '2025-01-01' };
const cats: Category[] = [{ id: 10, name: 'Courses', kind: 'expense',
  color: null, parentId: null, isDefault: false }];
const t: Transaction = { id: 1, accountId: 1, date: '2026-06-15', amount: '-42.30',
  rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour', memo: null, notes: null,
  fitid: null, dedupKey: 'dk-1', categoryId: null, categorySource: 'auto',
  transferGroupId: null, sourceFileId: null, importedAt: '2026-06-15T00:00:00Z' };

describe('TransactionRow', () => {
  it('renders date, amount, and label', () => {
    render(<table><tbody>
      <TransactionRow tx={t} categories={cats} accounts={[acc]}
        onUpdateCategory={() => {}} onUpdateNotes={() => {}} onDelete={() => {}} />
    </tbody></table>);
    expect(screen.getByText('CB CARREFOUR')).toBeInTheDocument();
    expect(screen.getByText(/42[,.]30/)).toBeInTheDocument();
  });

  it('fires onUpdateCategory with only-changed-field patch', async () => {
    const onUpdateCategory = vi.fn();
    const user = userEvent.setup();
    render(<table><tbody>
      <TransactionRow tx={t} categories={cats} accounts={[acc]}
        onUpdateCategory={onUpdateCategory} onUpdateNotes={() => {}} onDelete={() => {}} />
    </tbody></table>);
    // Trigger the category-cell inline edit. Adjust to actual affordance.
    // await user.click(within(row).getByRole('button', { name: /catégorie/i }));
    // await user.selectOptions(within(row).getByRole('combobox'), '10');
    // expect(onUpdateCategory).toHaveBeenCalledWith(1, { categoryId: 10 });
  });

  it('fires onUpdateNotes with only-changed-field patch', async () => {
    const onUpdateNotes = vi.fn();
    const user = userEvent.setup();
    render(<table><tbody>
      <TransactionRow tx={t} categories={cats} accounts={[acc]}
        onUpdateCategory={() => {}} onUpdateNotes={onUpdateNotes} onDelete={() => {}} />
    </tbody></table>);
    // Trigger notes-cell inline edit; adjust to actual affordance.
    // expect(onUpdateNotes).toHaveBeenCalledWith(1, { notes: 'new note' });
  });

  it('fires onDelete(tx) when the delete affordance is clicked', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<table><tbody>
      <TransactionRow tx={t} categories={cats} accounts={[acc]}
        onUpdateCategory={() => {}} onUpdateNotes={() => {}} onDelete={onDelete} />
    </tbody></table>);
    // Adjust to the actual delete button.
    // await user.click(within(row).getByRole('button', { name: /supprimer|delete/i }));
    // expect(onDelete).toHaveBeenCalledWith(t);
  });
});
```

Read `TransactionRow.tsx` to determine the actual inline-edit affordances and fill in the `await user.click(...)` / `await user.type(...)` lines. If the row's inline-edit interaction is more complex than a click-plus-select, adjust the tests — do NOT modify the row.

- [ ] **Step 3: Run the two new files**

```bash
cd frontend && npx vitest run src/pages/Transactions/__tests__/Th.test.tsx src/pages/Transactions/__tests__/TransactionRow.test.tsx
```
Expected: all tests pass.

- [ ] **Step 4: Full suite**

```bash
cd frontend && npx vitest run
```
Expected: full suite green (8 characterization + new leaf tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions/__tests__/Th.test.tsx frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx
git commit -m "$(cat <<'EOF'
test(transactions): unit tests for Th and TransactionRow

Th: 3 tests (label render, onSort callback, active-sort indicator).
TransactionRow: 4 tests (row render, inline category edit with
only-changed-field patch, inline notes edit, delete callback).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — Unit tests: `TransactionsTable` + `FiltersBar` + `TransactionModal`

**Files:**
- Create: `frontend/src/pages/Transactions/__tests__/TransactionsTable.test.tsx`
- Create: `frontend/src/pages/Transactions/__tests__/FiltersBar.test.tsx`
- Create: `frontend/src/pages/Transactions/__tests__/TransactionModal.test.tsx`

**Interfaces:**
- Consumes: the three extracted components.
- Produces: three unit-test files.

- [ ] **Step 1: Write `TransactionsTable.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionsTable } from '../TransactionsTable';
import type { Transaction, Category, Account } from '../../../api/types';

const acc: Account = { id: 1, name: 'Compte', type: 'checking', currency: 'EUR',
  openingBalance: '0.00', openingDate: '2025-01-01' };
const cats: Category[] = [{ id: 10, name: 'Courses', kind: 'expense',
  color: null, parentId: null, isDefault: false }];
const rows: Transaction[] = [
  { id: 1, accountId: 1, date: '2026-06-15', amount: '-10.00',
    rawLabel: 'A', normalizedLabel: 'a', memo: null, notes: null, fitid: null,
    dedupKey: 'x', categoryId: null, categorySource: 'auto',
    transferGroupId: null, sourceFileId: null, importedAt: '2026-06-15T00:00:00Z' },
  { id: 2, accountId: 1, date: '2026-06-16', amount: '-20.00',
    rawLabel: 'B', normalizedLabel: 'b', memo: null, notes: null, fitid: null,
    dedupKey: 'y', categoryId: null, categorySource: 'auto',
    transferGroupId: null, sourceFileId: null, importedAt: '2026-06-16T00:00:00Z' },
];

describe('TransactionsTable', () => {
  it('renders one row per transaction', () => {
    render(<TransactionsTable
      transactions={rows} categories={cats} accounts={[acc]}
      sortField="date" sortDir="desc" onSort={() => {}}
      onUpdateCategory={() => {}} onUpdateNotes={() => {}} onDelete={() => {}}
    />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('fires onSort(field) when a column header is clicked', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(<TransactionsTable
      transactions={rows} categories={cats} accounts={[acc]}
      sortField="date" sortDir="desc" onSort={onSort}
      onUpdateCategory={() => {}} onUpdateNotes={() => {}} onDelete={() => {}}
    />);
    // Click a header — adjust the label to actual DOM.
    await user.click(screen.getByText(/date/i));
    expect(onSort).toHaveBeenCalled();
  });

  it('shows empty-state copy when transactions is empty', () => {
    render(<TransactionsTable
      transactions={[]} categories={cats} accounts={[acc]}
      sortField="date" sortDir="desc" onSort={() => {}}
      onUpdateCategory={() => {}} onUpdateNotes={() => {}} onDelete={() => {}}
    />);
    // Adjust regex to the actual empty-state string.
    expect(screen.getByText(/aucune transaction|no transactions|empty/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write `FiltersBar.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FiltersBar } from '../FiltersBar';
import type { Account, Category } from '../../../api/types';

const accs: Account[] = [
  { id: 1, name: 'A', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
  { id: 2, name: 'B', type: 'savings',  currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
];
const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false },
];

const defaultFilters = {
  accountId: '' as number | '',
  categoryId: '' as number | '',
  dateFrom: '',
  dateTo: '',
  search: '',
};

// Same fieldFor helper used elsewhere in the suite. Adjust if the component
// wires labels with proper for/id (then getByLabelText suffices).
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control near label ${String(labelText)}`);
  return control as HTMLElement;
}

describe('FiltersBar', () => {
  it('renders account and category dropdowns from props', () => {
    render(<FiltersBar
      filters={defaultFilters} searchInput=""
      accounts={accs} categories={cats}
      showAdvanced onToggleAdvanced={() => {}}
      onFilterChange={() => {}} onSearchInputChange={() => {}}
    />);
    expect(screen.getByRole('option', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Courses' })).toBeInTheDocument();
  });

  it('fires onFilterChange when account is picked', async () => {
    const onFilterChange = vi.fn();
    const user = userEvent.setup();
    render(<FiltersBar
      filters={defaultFilters} searchInput=""
      accounts={accs} categories={cats}
      showAdvanced onToggleAdvanced={() => {}}
      onFilterChange={onFilterChange} onSearchInputChange={() => {}}
    />);
    await user.selectOptions(fieldFor(/compte|account/i), '2');
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ accountId: 2 }));
  });

  it('fires onSearchInputChange synchronously (no internal debounce)', async () => {
    const onSearchInputChange = vi.fn();
    const user = userEvent.setup();
    render(<FiltersBar
      filters={defaultFilters} searchInput=""
      accounts={accs} categories={cats}
      showAdvanced onToggleAdvanced={() => {}}
      onFilterChange={() => {}} onSearchInputChange={onSearchInputChange}
    />);
    await user.type(fieldFor(/rechercher|search/i), 'x');
    // No debounce inside FiltersBar — raw callback per keystroke.
    expect(onSearchInputChange).toHaveBeenCalledWith('x');
  });
});
```

Adjust `expect.objectContaining` shape depending on whether `accountId` is a `number`, a `string`, or an `''` sentinel — read the source's onChange conversion.

- [ ] **Step 3: Write `TransactionModal.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionModal } from '../TransactionModal';
import type { Account, Category } from '../../../api/types';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

const accs: Account[] = [
  { id: 1, name: 'Compte', type: 'checking', currency: 'EUR',
    openingBalance: '0', openingDate: '2025-01-01' },
];
const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense',
    color: null, parentId: null, isDefault: false },
];

function renderModal(props: any = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TransactionModal
        open={true}
        initialTx={null}
        accounts={accs}
        categories={cats}
        onClose={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('TransactionModal', () => {
  it('submits with the shaped body', async () => {
    apiMock.mockResolvedValue({ transaction: { id: 999 } });
    const user = userEvent.setup();
    renderModal();

    // Adjust field labels to the actual DOM.
    // await user.selectOptions(screen.getByLabelText(/compte|account/i), '1');
    // fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-06-15' } });
    // await user.type(screen.getByLabelText(/montant|amount/i), '-42.30');
    // await user.type(screen.getByLabelText(/libellé|label/i), 'CB CARREFOUR');
    // await user.click(screen.getByRole('button', { name: /créer|save|valider/i }));

    // await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/transactions', expect.objectContaining({
    //   method: 'POST',
    //   json: expect.objectContaining({ accountId: 1, date: '2026-06-15', amount: '-42.30', rawLabel: 'CB CARREFOUR' }),
    // })));
  });

  it('does not submit when required fields are empty', async () => {
    apiMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderModal();
    // Click submit directly; either the native form-required guard fires or
    // the submit button is disabled — assert whichever the component uses.
    // await user.click(screen.getByRole('button', { name: /créer|save/i }));
    // expect(apiMock).not.toHaveBeenCalled();
  });

  it('fires onClose when the cancel/close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal({ onClose });
    await user.click(screen.getByRole('button', { name: /annuler|fermer|close|cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

Fill in the field interactions once you've read `TransactionModal.tsx` for actual labels + submit button text.

- [ ] **Step 4: Run the three new files**

```bash
cd frontend && npx vitest run src/pages/Transactions/__tests__/TransactionsTable.test.tsx src/pages/Transactions/__tests__/FiltersBar.test.tsx src/pages/Transactions/__tests__/TransactionModal.test.tsx
```
Expected: all tests pass.

- [ ] **Step 5: Full suite**

```bash
cd frontend && npx vitest run
```
Expected: full suite green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Transactions/__tests__/
git commit -m "$(cat <<'EOF'
test(transactions): unit tests for TransactionsTable, FiltersBar, TransactionModal

TransactionsTable: 3 tests (rows render, sort callback, empty state).
FiltersBar: 3 tests (dropdowns populated, account filter callback,
search input is synchronous — debounce lives in parent).
TransactionModal: 3 tests (submit body shape, required-guard,
close callback).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — Update `STATUS.md` + push

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Update `Recently landed`**

Add at the top:

```markdown
- 2026-07-02 — Transactions.tsx split into pages/Transactions/ (6 focused
  files) with characterization + unit tests. Third interleave iteration.
```

- [ ] **Step 2: Update the refactor table**

Change the Transactions.tsx row to `✅ (8) / ✅ / ✅ (~18)`.

- [ ] **Step 3: Update `_Last updated:_`**

`_Last updated: 2026-07-02_`.

- [ ] **Step 4: TSC + full suite**

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
cd frontend && npx vitest run
```
Expected: 0 errors, full suite green.

- [ ] **Step 5: Commit + push**

```bash
git add STATUS.md
git commit -m "$(cat <<'EOF'
docs(status): mark Transactions.tsx refactor+tests iteration complete

Third interleave iteration. 8 characterization + ~18 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 6: Watch the CI run**

```bash
gh run watch $(gh run list --workflow ci.yml --limit 1 --repo Gekkotron/Athena-Accounting --json databaseId --jq '.[0].databaseId') --repo Gekkotron/Athena-Accounting --exit-status
```
Expected: both jobs green.

---

## Self-review notes

- **Spec coverage:** every spec section maps to a task. Characterization → Task 1. Relocation → Task 2. Split → Tasks 3–7 (leaf-first: Th → TransactionRow → TransactionsTable → FiltersBar → TransactionModal). Unit tests → Tasks 8–9 (leaves vs. containers). STATUS.md → Task 10.
- **Type consistency:** `TransactionRow`'s prop signature (Task 4) is consumed by `TransactionsTable` (Task 5) and the row unit tests (Task 8). All references use the shape `{ tx, categories, accounts, onUpdateCategory(id, patch), onUpdateNotes(id, patch), onDelete(tx) }` — the implementer must confirm real prop names against the extracted file before adopting the sample.
- **Placeholder scan:** no TBDs. The test files' inline `// ...` comments are legitimate "adapt to real DOM" markers, not incomplete work — every step has a clear invariant (e.g., "assert putBodies[0] === { categoryId: 10 }") even when the exact interaction is DOM-specific.
- **Behavior-preservation guardrails:** search-debounce lives in `index.tsx` (Task 6 keeps it there); Test #3 uses fake timers as the deterministic gate; Test #5/#6/#7 all assert single-field patches on the mutation calls (the diff-only-changed-fields safety net inherited from Rules/Accounts).
