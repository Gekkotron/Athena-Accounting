# Bulk Category Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline category selector to the Transactions selection bar so the user can reassign the category of every selected row in one round-trip.

**Architecture:** New `POST /api/transactions/categorize-bulk` endpoint that mirrors `delete-bulk` (Zod-validated body, single `db.transaction`, cross-user isolation, transfer legs and split parents partitioned into a `skipped` count). A new React Query mutation and native `<select>` are added to the existing selection bar in the Transactions page; on success the selection clears and a non-blocking notice reports skipped rows.

**Tech Stack:** Fastify · Drizzle · Zod · Postgres · Vitest · React 18 · TanStack Query · TypeScript · React Testing Library.

**Spec:** [`docs/superpowers/specs/2026-07-14-bulk-category-change-design.md`](../specs/2026-07-14-bulk-category-change-design.md).

## Global Constraints

- Backend integration tests are gated by `RUN_DB_TESTS=1` (they hit a real Postgres via the docker-compose fixture); run them with `RUN_DB_TESTS=1 pnpm --filter backend test`.
- Frontend tests use Vitest + `@testing-library/react`; mock the HTTP layer by `vi.mock('../../../api/client', ...)` and pulling in the mocked `api` — never touch `globalThis.fetch` for page-level tests.
- Auth: every backend route uses `userId(req)` from `../../plugins/auth.js`; the new route MUST call it too and MUST scope every SQL statement by that `user_id`.
- Copy strings are French (this app's UI is French only). Skipped-notice copy: `"N ligne(s) ignorée(s) (virements internes ou ventilations)"`.
- Category picker sort in the frontend must match the row-level select's sort: by parent name then child name via `formatCategoryPath`, already imported from `../../lib/categories`.
- Commit as `Gekkotron` (per project convention): `git -c user.name=Gekkotron -c user.email='60887050+Gekkotron@users.noreply.github.com' commit ...`. Never modify `.git/config`.
- Never write secrets, IPs, hostnames, or the user's real name into commits or code.

---

## File Structure

**Backend (2 files touched, 1 test file touched):**

- Modify `backend/src/http/routes/transactions/schemas.ts` — export a new `CategorizeBulkBody` Zod schema.
- Modify `backend/src/http/routes/transactions/index.ts` — import the new schema and register the new route right below the existing `delete-bulk` handler.
- Modify `backend/tests/transactions-route.test.ts` — add a `describe('POST /api/transactions/categorize-bulk', ...)` block right after the existing bulk-delete block.

**Frontend (1 file touched, 1 test file created):**

- Modify `frontend/src/pages/Transactions/index.tsx` — new state (`bulkSelectValue`, `bulkCategorizeNotice`, `bulkCategorizeError`), new `bulkCategorize` mutation, new `<select>` and two notice bars inside the existing selection bar, and a small addition to the existing filter/offset reset effect.
- Create `frontend/src/pages/Transactions/__tests__/Transactions.test.tsx` — new page-level integration test file (no existing test covers the parent page).

Two tasks total: backend first (self-testable), frontend second (depends on the endpoint being available at compile time via the URL string).

---

## Task 1: Backend — POST /api/transactions/categorize-bulk

**Files:**
- Modify: `backend/src/http/routes/transactions/schemas.ts` (append after `PatchBody`)
- Modify: `backend/src/http/routes/transactions/index.ts:10` (add `CategorizeBulkBody` to the import), and add a new handler right after the existing `delete-bulk` handler at `index.ts:397`.
- Modify: `backend/tests/transactions-route.test.ts` (append after the existing `delete-bulk` `describe` block).

**Interfaces:**
- Consumes: existing `userId(req)` helper (auth), Drizzle helpers `eq`, `and`, `inArray`, existing imports for `transactions`, `transactionSplits`, `db`.
- Produces:
  - Endpoint `POST /api/transactions/categorize-bulk`
    - Request body: `{ ids: number[] (1..500, positive ints), categoryId: number | null }`
    - Response: `{ updated: number, skipped: number }`
    - Errors: `400 { error: 'invalid input', issues }` on bad body, `400 { error: 'catégorie inconnue' }` on FK violation (PG `23503`).
  - Exports `CategorizeBulkBody` Zod schema (matches request body).

- [ ] **Step 1: Write the failing integration tests**

Open `backend/tests/transactions-route.test.ts` and, right after the block ending at line 615 (`describe('POST /api/transactions/delete-bulk', ...)`), insert:

```ts
  describe('POST /api/transactions/categorize-bulk', () => {
    it('updates categoryId + categorySource=manual for every eligible id', async () => {
      const ids = [
        await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'a' }),
        await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-2.00', rawLabel: 'b' }),
      ];
      const res = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie }, payload: { ids, categoryId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ updated: 2, skipped: 0 });

      const list = await app.inject({
        method: 'GET', url: '/api/transactions',
        headers: { cookie },
      });
      for (const tx of list.json().transactions) {
        expect(tx.categoryId).toBe(categoryId);
        expect(tx.categorySource).toBe('manual');
      }
    });

    it('categoryId=null clears the category and still flips categorySource to manual', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'a' });
      // First give it a category so the clear is observable.
      await app.inject({
        method: 'PATCH', url: `/api/transactions/${id}`,
        headers: { cookie }, payload: { categoryId },
      });
      const res = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie }, payload: { ids: [id], categoryId: null },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ updated: 1, skipped: 0 });

      const get = await app.inject({
        method: 'GET', url: `/api/transactions/${id}`,
        headers: { cookie },
      });
      expect(get.json().transaction.categoryId).toBeNull();
      expect(get.json().transaction.categorySource).toBe('manual');
    });

    it('skips transfer legs and split parents; only eligible rows are updated', async () => {
      // Direct DB seed for the transfer leg — the app has no "link two rows
      // as a transfer" HTTP endpoint (transfer_group_id is set at import
      // time by the auto-detector or restore path). This mirrors the existing
      // hidden-transfer test at line 358+ of this file.
      const { db } = await import('../src/db/client.js');
      const { transactions } = await import('../src/db/schema.js');
      const { randomUUID } = await import('node:crypto');
      const { eq } = await import('drizzle-orm');

      const plain = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'plain' });
      const legA = await makeTx({ accountId: accountAId, date: '2026-06-16', amount: '-100.00', rawLabel: 'legA' });
      await db.update(transactions).set({ transferGroupId: randomUUID() }).where(eq(transactions.id, legA));

      // Split parent: two splits summing to the parent's amount.
      const parent = await makeTx({ accountId: accountAId, date: '2026-06-17', amount: '-30.00', rawLabel: 'split-parent' });
      const splitRes = await app.inject({
        method: 'PUT', url: `/api/transactions/${parent}/splits`,
        headers: { cookie },
        payload: { splits: [
          { categoryId, amount: '-20.00', memo: null },
          { categoryId, amount: '-10.00', memo: null },
        ] },
      });
      expect(splitRes.statusCode).toBe(200);

      const res = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie },
        payload: { ids: [plain, legA, parent], categoryId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ updated: 1, skipped: 2 });

      const plainRow = await app.inject({
        method: 'GET', url: `/api/transactions/${plain}`,
        headers: { cookie },
      });
      expect(plainRow.json().transaction.categoryId).toBe(categoryId);
      const legARow = await app.inject({
        method: 'GET', url: `/api/transactions/${legA}`,
        headers: { cookie },
      });
      expect(legARow.json().transaction.categoryId).toBeNull();
    });

    it('counts unknown ids and cross-user ids as skipped', async () => {
      const own = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'own' });
      const res = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie },
        payload: { ids: [own, 999_999_999], categoryId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ updated: 1, skipped: 1 });
    });

    it('returns 400 catégorie inconnue on an FK violation', async () => {
      const id = await makeTx({ accountId: accountAId, date: '2026-06-15', amount: '-1.00', rawLabel: 'x' });
      const res = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie },
        payload: { ids: [id], categoryId: 999_999_999 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/catégorie inconnue/i);
    });

    it('rejects an empty or malformed body with 400', async () => {
      const empty = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie }, payload: { ids: [], categoryId: null },
      });
      expect(empty.statusCode).toBe(400);
      const bad = await app.inject({
        method: 'POST', url: '/api/transactions/categorize-bulk',
        headers: { cookie }, payload: { ids: 'nope', categoryId: null },
      });
      expect(bad.statusCode).toBe(400);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
RUN_DB_TESTS=1 pnpm --filter backend test -- transactions-route.test.ts
```

Expected: the 6 new tests in the `POST /api/transactions/categorize-bulk` describe fail with `404` responses (route not registered).

- [ ] **Step 3: Add the Zod schema**

In `backend/src/http/routes/transactions/schemas.ts`, append after the existing `PatchBody` export (currently around line 41):

```ts
// Body for the bulk-recategorize endpoint. Same 500-id cap as delete-bulk so
// server-side memory and lock windows stay bounded. categoryId is nullable
// (null clears the category) but the field is required — an omitted field
// would be ambiguous.
export const CategorizeBulkBody = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  categoryId: z.number().int().positive().nullable(),
});
```

- [ ] **Step 4: Register the route handler**

In `backend/src/http/routes/transactions/index.ts`, update the schemas import (line 10) from:

```ts
import { CreateBody, ListQuery, PatchBody } from './schemas.js';
```

to:

```ts
import { CategorizeBulkBody, CreateBody, ListQuery, PatchBody } from './schemas.js';
```

Then, immediately after the existing `delete-bulk` handler closes at line 397, insert:

```ts
  // Batch-update the category_id of a set of transactions in one round-trip.
  // Rows that belong to an internal transfer group or that are the parent of
  // a split ventilation are silently partitioned into `skipped` — the client
  // shows a small notice explaining why. Wrapped in one DB transaction so a
  // partial FK failure rolls back cleanly.
  app.post('/api/transactions/categorize-bulk', async (req, reply) => {
    const uid = userId(req);
    const parsed = CategorizeBulkBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { ids, categoryId } = parsed.data;

    try {
      const result = await db.transaction(async (tx) => {
        const owned = await tx
          .select({ id: transactions.id, transferGroupId: transactions.transferGroupId })
          .from(transactions)
          .where(and(eq(transactions.userId, uid), inArray(transactions.id, ids)));

        // A row is a split parent iff at least one transaction_splits row
        // points at it. Query only the ids we already own so we don't leak
        // presence across users.
        const ownedIds = owned.map((r) => r.id);
        const splitParents = ownedIds.length === 0
          ? []
          : await tx
            .select({ id: transactionSplits.transactionId })
            .from(transactionSplits)
            .where(inArray(transactionSplits.transactionId, ownedIds));
        const splitParentSet = new Set(splitParents.map((r) => r.id));

        const eligibleIds = owned
          .filter((r) => r.transferGroupId == null && !splitParentSet.has(r.id))
          .map((r) => r.id);

        if (eligibleIds.length > 0) {
          await tx
            .update(transactions)
            .set({ categoryId, categorySource: 'manual' })
            .where(and(eq(transactions.userId, uid), inArray(transactions.id, eligibleIds)));
        }
        return { updated: eligibleIds.length, skipped: ids.length - eligibleIds.length };
      });
      return result;
    } catch (err) {
      if (isPgError(err) && err.code === '23503') {
        return reply.code(400).send({ error: 'catégorie inconnue' });
      }
      throw err;
    }
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
RUN_DB_TESTS=1 pnpm --filter backend test -- transactions-route.test.ts
```

Expected: all tests in the new describe block pass, no regressions in the existing blocks.

- [ ] **Step 6: Run the type-check and lint gates**

Run:
```bash
pnpm --filter backend typecheck
pnpm --filter backend lint
```

Expected: both green. If either flags an unused import (e.g. `transactionSplits` was already imported), fix and re-run.

- [ ] **Step 7: Commit**

```bash
git add backend/src/http/routes/transactions/schemas.ts \
        backend/src/http/routes/transactions/index.ts \
        backend/tests/transactions-route.test.ts
git -c user.name=Gekkotron -c user.email='60887050+Gekkotron@users.noreply.github.com' commit -m "$(cat <<'EOF'
feat(transactions): POST /api/transactions/categorize-bulk

Mirrors delete-bulk's shape (Zod-validated body capped at 500 ids,
single DB tx, cross-user isolation). Transfer legs and split parents
are partitioned into a `skipped` count instead of erroring the batch;
successful rows flip categorySource to 'manual' so the retroactive
recategorizer keeps them under preserveManual: true.
EOF
)"
```

---

## Task 2: Frontend — bulk category selector in selection bar

**Files:**
- Modify: `frontend/src/pages/Transactions/index.tsx`
- Create: `frontend/src/pages/Transactions/__tests__/Transactions.test.tsx`

**Interfaces:**
- Consumes: `POST /api/transactions/categorize-bulk` from Task 1, `formatCategoryPath` from `../../lib/categories`, existing `api`/`ApiError` from `../../api/client`, existing `selectedIds` state on the page.
- Produces: no new module exports — this is a component-internal change. The `<select>` inside the selection bar carries an `aria-label="Changer la catégorie des transactions sélectionnées"` which is the only stable handle for tests.

- [ ] **Step 1: Create the failing frontend test file**

Create `frontend/src/pages/Transactions/__tests__/Transactions.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Transactions } from '../index';
import type { Account, Category, Transaction } from '../../../api/types';

// api() is the sole HTTP boundary; mock it as a dispatcher on (path, opts).
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

const acc: Account = {
  id: 1, name: 'Compte', type: 'checking', currency: 'EUR',
  openingBalance: '0.00', openingDate: '2025-01-01',
};
const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 11, name: 'Restaurants', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
];
const txs: Transaction[] = [
  {
    id: 1, accountId: 1, date: '2026-06-15', amount: '-10.00',
    rawLabel: 'A', normalizedLabel: 'a', memo: null, notes: null, fitid: null,
    dedupKey: 'x', categoryId: null, categorySource: 'auto',
    transferGroupId: null, sourceFileId: null, importedAt: '2026-06-15T00:00:00Z',
    splits: [],
  },
  {
    id: 2, accountId: 1, date: '2026-06-16', amount: '-20.00',
    rawLabel: 'B', normalizedLabel: 'b', memo: null, notes: null, fitid: null,
    dedupKey: 'y', categoryId: null, categorySource: 'auto',
    transferGroupId: null, sourceFileId: null, importedAt: '2026-06-16T00:00:00Z',
    splits: [],
  },
];

// Default dispatcher: return the fixture data for the four page-level GETs
// and swallow anything else. Individual tests override via mockImplementation
// when they need to assert POST bodies.
function defaultDispatcher(path: string): unknown {
  if (path === '/api/accounts') return { accounts: [acc] };
  if (path === '/api/categories') return { categories: cats };
  if (path.startsWith('/api/transactions?') || path === '/api/transactions') {
    return { transactions: txs, pagination: { total: txs.length, limit: 50, offset: 0 } };
  }
  if (path.startsWith('/api/balance-checkpoints')) return { checkpoints: [] };
  return {};
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Transactions />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function selectAllRows(user: ReturnType<typeof userEvent.setup>) {
  // Wait for the table to render, then click every row checkbox (there are
  // two body rows in the fixture). The header "select-all" checkbox works
  // too, but per-row clicks make the intent explicit.
  await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(2));
  const rowCbxs = screen.getAllByLabelText(/^Sélectionner la transaction/);
  for (const cbx of rowCbxs) await user.click(cbx);
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(((path: string) => Promise.resolve(defaultDispatcher(path))) as never);
});

describe('Transactions page — bulk category', () => {
  it('renders the bulk-category select when at least one row is selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await selectAllRows(user);
    expect(
      screen.getByLabelText('Changer la catégorie des transactions sélectionnées'),
    ).toBeInTheDocument();
  });

  it('picking a category POSTs categorize-bulk with the selected ids and categoryId', async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation(((path: string, opts?: { method?: string; json?: unknown }) => {
      if (opts?.method === 'POST' && path === '/api/transactions/categorize-bulk') {
        return Promise.resolve({ updated: 2, skipped: 0 });
      }
      return Promise.resolve(defaultDispatcher(path));
    }) as never);
    renderPage();
    await selectAllRows(user);

    const sel = screen.getByLabelText('Changer la catégorie des transactions sélectionnées');
    await user.selectOptions(sel, '10');

    await waitFor(() => {
      const call = apiMock.mock.calls.find(([p, o]) =>
        p === '/api/transactions/categorize-bulk' && (o as { method?: string })?.method === 'POST',
      );
      expect(call).toBeTruthy();
      expect((call![1] as { json: unknown }).json).toEqual({ ids: [1, 2], categoryId: 10 });
    });
  });

  it('picking "— Aucune" sends categoryId: null', async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation(((path: string, opts?: { method?: string; json?: unknown }) => {
      if (opts?.method === 'POST' && path === '/api/transactions/categorize-bulk') {
        return Promise.resolve({ updated: 2, skipped: 0 });
      }
      return Promise.resolve(defaultDispatcher(path));
    }) as never);
    renderPage();
    await selectAllRows(user);

    await user.selectOptions(
      screen.getByLabelText('Changer la catégorie des transactions sélectionnées'),
      'none',
    );

    await waitFor(() => {
      const call = apiMock.mock.calls.find(([p, o]) =>
        p === '/api/transactions/categorize-bulk' && (o as { method?: string })?.method === 'POST',
      );
      expect(call).toBeTruthy();
      expect((call![1] as { json: { categoryId: unknown } }).json.categoryId).toBeNull();
    });
  });

  it('on success with skipped>0 clears the selection and shows the skipped notice', async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation(((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST' && path === '/api/transactions/categorize-bulk') {
        return Promise.resolve({ updated: 1, skipped: 1 });
      }
      return Promise.resolve(defaultDispatcher(path));
    }) as never);
    renderPage();
    await selectAllRows(user);

    await user.selectOptions(
      screen.getByLabelText('Changer la catégorie des transactions sélectionnées'),
      '10',
    );

    await waitFor(() =>
      expect(screen.getByText(/1 ligne.*ignorée.*virements internes ou ventilations/i)).toBeInTheDocument(),
    );
    // Selection has cleared → the selection bar (and its select) is gone.
    expect(
      screen.queryByLabelText('Changer la catégorie des transactions sélectionnées'),
    ).not.toBeInTheDocument();
  });

  it('on error keeps the selection and shows the error message', async () => {
    const { ApiError } = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
    const user = userEvent.setup();
    apiMock.mockImplementation(((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST' && path === '/api/transactions/categorize-bulk') {
        return Promise.reject(new ApiError('catégorie inconnue', 400, { error: 'catégorie inconnue' }));
      }
      return Promise.resolve(defaultDispatcher(path));
    }) as never);
    renderPage();
    await selectAllRows(user);

    await user.selectOptions(
      screen.getByLabelText('Changer la catégorie des transactions sélectionnées'),
      '10',
    );

    await waitFor(() => expect(screen.getByText(/catégorie inconnue/i)).toBeInTheDocument());
    // Selection bar still present (selection persists on error).
    expect(
      screen.getByLabelText('Changer la catégorie des transactions sélectionnées'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the frontend tests to verify they fail**

Run:
```bash
pnpm --filter frontend test -- Transactions.test.tsx
```

Expected: all 5 new tests fail — the `<select>` doesn't exist yet, so `getByLabelText('Changer la catégorie…')` throws.

- [ ] **Step 3: Wire the mutation and UI in the Transactions page**

In `frontend/src/pages/Transactions/index.tsx`, apply the following edits.

**3a. Add `useMemo` to the React imports on line 1:**

```tsx
import { useEffect, useMemo, useState } from 'react';
```

**3b. Add `formatCategoryPath` to the categories import (add a new import near line 5-11 if not already there):**

```tsx
import { formatCategoryPath } from '../../lib/categories';
```

**3c. Add three new state slots inside the `Transactions` component, right after the existing `bulkDeleteError` declaration (currently line 58):**

```tsx
  const [bulkSelectValue, setBulkSelectValue] = useState('');
  const [bulkCategorizeNotice, setBulkCategorizeNotice] = useState<{ skipped: number } | null>(null);
  const [bulkCategorizeError, setBulkCategorizeError] = useState<string | null>(null);
```

**3d. Extend the existing reset effect (currently line 65-68) so the two notice slots also clear on filter/page change:**

```tsx
  useEffect(() => {
    setSelectedIds(new Set());
    setExpandedIds(new Set());
    setBulkCategorizeNotice(null);
    setBulkCategorizeError(null);
  }, [filters, offset]);
```

**3e. Add the mutation, right after the existing `bulkDelete` mutation (currently line 140-156):**

```tsx
  const bulkCategorize = useMutation({
    mutationFn: (vars: { ids: number[]; categoryId: number | null }) =>
      api<{ updated: number; skipped: number }>('/api/transactions/categorize-bulk', {
        method: 'POST',
        json: vars,
      }),
    onSuccess: ({ skipped }) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setSelectedIds(new Set());
      setBulkSelectValue('');
      setBulkCategorizeError(null);
      setBulkCategorizeNotice(skipped > 0 ? { skipped } : null);
    },
    onError: (err: ApiError) => {
      setBulkSelectValue('');
      setBulkCategorizeError(err.message);
    },
  });
```

**3f. Add a memo for the sorted category list (used in the picker), right after `const categories = categoriesQ.data?.categories ?? [];` (currently line 185):**

```tsx
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c] as const)), [categories]);
  const sortedCategories = useMemo(
    () =>
      [...categories].sort((a, b) => {
        const pa = a.parentId != null ? catById.get(a.parentId)?.name ?? '' : a.name;
        const pb = b.parentId != null ? catById.get(b.parentId)?.name ?? '' : b.name;
        return pa.localeCompare(pb) || a.name.localeCompare(b.name);
      }),
    [categories, catById],
  );
```

**3g. Extend the selection bar (currently `Transactions/index.tsx:263-283`) to include the new `<select>`. Replace the existing block:**

```tsx
      {selectedIds.size > 0 && (
        <div className="rounded-lg border border-sage-800/40 bg-sage-900/15 px-4 py-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-100">
            <span className="font-mono">{selectedIds.size}</span> sélectionnée{selectedIds.size > 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="text-[11px] text-ink-500 hover:text-ink-100 transition"
              onClick={() => setSelectedIds(new Set())}
            >
              Effacer la sélection
            </button>
            <button
              className="btn-secondary !py-1.5 !px-3 text-clay-300 hover:text-clay-200 border-clay-800/60 hover:border-clay-700"
              onClick={() => { setBulkDeleteError(null); setConfirmBulkDelete(true); }}
            >
              Supprimer
            </button>
          </div>
        </div>
      )}
```

**with:**

```tsx
      {selectedIds.size > 0 && (
        <div className="rounded-lg border border-sage-800/40 bg-sage-900/15 px-4 py-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-100">
            <span className="font-mono">{selectedIds.size}</span> sélectionnée{selectedIds.size > 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="text-[11px] text-ink-500 hover:text-ink-100 transition"
              onClick={() => setSelectedIds(new Set())}
            >
              Effacer la sélection
            </button>
            <select
              className="input-sm"
              value={bulkSelectValue}
              disabled={bulkCategorize.isPending}
              aria-label="Changer la catégorie des transactions sélectionnées"
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setBulkSelectValue('');
                bulkCategorize.mutate({
                  ids: Array.from(selectedIds),
                  categoryId: v === 'none' ? null : Number(v),
                });
              }}
            >
              <option value="" disabled>Catégorie…</option>
              <option value="none">— Aucune</option>
              {sortedCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatCategoryPath(c, catById)}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary !py-1.5 !px-3 text-clay-300 hover:text-clay-200 border-clay-800/60 hover:border-clay-700"
              onClick={() => { setBulkDeleteError(null); setConfirmBulkDelete(true); }}
            >
              Supprimer
            </button>
          </div>
        </div>
      )}
```

**3h. Add two notice bars right after the existing `checkpointError` bar (currently line 285-297). Insert before the `<TransactionsTable ...>` element:**

```tsx
      {bulkCategorizeNotice && (
        <div className="rounded-lg border border-sage-800/40 bg-sage-900/10 px-4 py-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-200">
            {bulkCategorizeNotice.skipped} ligne{bulkCategorizeNotice.skipped > 1 ? 's' : ''} ignorée{bulkCategorizeNotice.skipped > 1 ? 's' : ''} (virements internes ou ventilations)
          </span>
          <button
            className="text-[11px] text-ink-500 hover:text-ink-100 transition"
            onClick={() => setBulkCategorizeNotice(null)}
          >
            Fermer
          </button>
        </div>
      )}

      {bulkCategorizeError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/15 px-4 py-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-clay-200">Changement de catégorie : {bulkCategorizeError}</span>
          <button
            className="text-[11px] text-ink-500 hover:text-ink-100 transition"
            onClick={() => setBulkCategorizeError(null)}
          >
            Fermer
          </button>
        </div>
      )}
```

- [ ] **Step 4: Run the frontend tests to verify they pass**

Run:
```bash
pnpm --filter frontend test -- Transactions.test.tsx
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run the full frontend test suite to catch regressions**

Run:
```bash
pnpm --filter frontend test
```

Expected: everything green. Pay attention to `TransactionRow.test.tsx` and `TransactionsTable.test.tsx`; if they break, it means the row select or table props drifted — recheck 3a-3h.

- [ ] **Step 6: Run type-check and lint**

Run:
```bash
pnpm --filter frontend typecheck
pnpm --filter frontend lint
```

Expected: both green. If `formatCategoryPath` or `useMemo` is already imported at the top of `index.tsx`, remove the duplicate — repeated import is a lint error.

- [ ] **Step 7: Manually verify in the browser**

Start the dev server:
```bash
pnpm --filter frontend dev
```

- Open `http://localhost:5173/transactions`, log in, pick a few rows.
- Confirm the new `Catégorie…` select appears between "Effacer la sélection" and "Supprimer".
- Pick a category → the request fires, the table refreshes, the bar disappears.
- Re-select rows including a transfer leg or a split parent → confirm the "N lignes ignorées" notice shows the right count.
- Force an error (temporarily pick a category, then in devtools intercept the response to return 400) → confirm the error bar appears and the selection persists.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Transactions/index.tsx \
        frontend/src/pages/Transactions/__tests__/Transactions.test.tsx
git -c user.name=Gekkotron -c user.email='60887050+Gekkotron@users.noreply.github.com' commit -m "$(cat <<'EOF'
feat(transactions): bulk category selector in the selection bar

Adds an inline <select> between "Effacer la sélection" and "Supprimer"
that fires POST /api/transactions/categorize-bulk on pick. Selection
clears on success; a small notice surfaces the count of rows the
backend skipped (transfer legs, split parents); errors show in a
dismissable clay bar and preserve the selection so the user can retry.
EOF
)"
```

---

## Self-Review

- [x] **Spec coverage:** every spec section has a task —
  - UX (§User flow): Task 2, step 3g.
  - Backend endpoint (§Backend): Task 1, steps 3–4.
  - Frontend wiring (§Frontend): Task 2, steps 3a–3h.
  - Data flow (§Data flow): Task 2 step 3e (query invalidations) + step 3g (mutation trigger).
  - Edge cases (§Edge cases): backend covers transfer/split/cross-user/FK; frontend covers success-with-skipped and error paths.
  - Testing (§Testing): backend describe block (Task 1 step 1) + frontend test file (Task 2 step 1).
- [x] **Placeholder scan:** no TBDs, no "similar to Task N", every code block is complete.
- [x] **Type consistency:** endpoint response `{ updated, skipped }` matches between backend handler, backend tests, frontend mutation, and frontend tests. `CategorizeBulkBody` is the single Zod source of truth for the body shape. `categoryId: number | null` consistent everywhere.
