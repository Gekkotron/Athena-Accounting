# Transaction splits implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user split one transaction across multiple categories, with a database-side guarantee that the pieces always sum to the parent amount to the cent.

**Architecture:** New `transaction_splits` table linked to `transactions` via `transaction_id`. Two Postgres triggers enforce (1) `SUM(splits.amount) = parent.amount` on any splits mutation (deferrable, so atomic replaces work) and (2) a lock on `transactions.amount` while splits exist. Category-aggregate queries switch to a split-aware UNION CTE. Editor lives inside `TransactionModal` as a new section; list rows collapse to a `[▸ Ventilée (N)]` badge that expands to sub-rows on click.

**Tech Stack:** Postgres 16 + Drizzle ORM, Fastify + Zod, React + React Query + Vitest (backend `vitest` with a live DB gated by `RUN_DB_TESTS=1`, frontend `vitest` with jsdom + Testing Library).

## Global Constraints

- **Signed amounts everywhere.** Splits store signed decimals matching the parent's sign; the UI accepts magnitudes and re-signs at submit.
- **DB-side checksum is a hard requirement.** Both triggers must land in the same migration as the table.
- **All routes require `preHandler: app.requireAuth`** and filter by `req.session.userId`.
- **Category aggregates**: only `/api/reports/categories` and `/api/tri/groups` change. Balance / timeseries / account totals stay identical.
- **Transfers cannot be split** (rows with `transfer_group_id IS NOT NULL`). Enforced in the backend service, not the DB.
- **Test gate**: backend DB tests run with `RUN_DB_TESTS=1 npm --prefix backend test`. Frontend tests run with `npm --prefix frontend test`.
- **Design doc**: `docs/superpowers/specs/2026-07-06-transaction-splits-design.md` is the source of truth for any semantic question this plan doesn't answer.

## File map

**Backend — create:**
- `backend/src/db/migrations/0014_transaction_splits.sql`
- `backend/src/http/routes/transactions/splits.ts`
- `backend/tests/transaction-splits-route.test.ts`

**Backend — modify:**
- `backend/src/db/schema.ts` (add `transactionSplits`)
- `backend/src/http/routes/transactions/index.ts` (register splits routes, hydrate `splits: []`, extend `categoryId` filter, add 23514 branch in PATCH)
- `backend/src/http/routes/reports.ts` (split-aware CTE)
- `backend/src/http/routes/tri.ts` (split-aware CTE)
- `backend/src/http/routes/backup/schema.ts` (VERSION bump, `splits` field)
- `backend/src/http/routes/backup/export.ts` (emit splits)
- `backend/src/http/routes/backup/restore.ts` (insert splits)

**Frontend — create:**
- `frontend/src/pages/Transactions/SplitEditor.tsx`
- `frontend/src/pages/Transactions/__tests__/SplitEditor.test.tsx`

**Frontend — modify:**
- `frontend/src/api/types.ts` (add `TransactionSplit`, extend `Transaction`)
- `frontend/src/pages/Transactions/TransactionModal.tsx` (embed `SplitEditor`, chain PUT/DELETE on submit)
- `frontend/src/pages/Transactions/TransactionRow.tsx` (badge + expandable sub-rows)
- `frontend/src/pages/Transactions/TransactionsTable.tsx` (thread expansion state)
- `frontend/src/pages/Transactions/index.tsx` (own the expanded-ids Set)
- `frontend/src/pages/Transactions/__tests__/TransactionModal.test.tsx` (fixtures now include `splits: []`)
- `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx` (fixtures now include `splits: []`; new expand test)

**Docs:**
- `TODO.md` (move split item to "Fait")

---

## Task 1 — Migration + Drizzle schema

**Files:**
- Create: `backend/src/db/migrations/0014_transaction_splits.sql`
- Modify: `backend/src/db/schema.ts` (append at end of file)
- Test: `backend/tests/transaction-splits-route.test.ts` (created; first three cases exercise the DB layer directly)

**Interfaces:**
- Produces: `transactionSplits` Drizzle table with columns `id, transactionId, categoryId, amount, memo`. Two triggers `transaction_splits_checksum_trg` and `transactions_amount_lock_when_split_trg` raise SQLSTATE 23514.

- [ ] **Step 1: Write the migration**

Create `backend/src/db/migrations/0014_transaction_splits.sql`:

```sql
-- Splits: one row per (transaction, category, portion). A transaction is
-- either single-category (no rows here; use transactions.category_id) OR
-- ventilated across N >= 2 splits whose amounts sum to parent.amount.

CREATE TABLE transaction_splits (
  id             SERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL
                   REFERENCES transactions(id) ON DELETE CASCADE,
  category_id    INTEGER
                   REFERENCES categories(id) ON DELETE SET NULL,
  amount         NUMERIC(14, 2) NOT NULL,
  memo           TEXT
);
CREATE INDEX transaction_splits_tx_idx  ON transaction_splits(transaction_id);
CREATE INDEX transaction_splits_cat_idx ON transaction_splits(category_id);

-- Checksum trigger: on any splits mutation, SUM(amount) for the affected
-- parent must equal parent.amount OR be 0 (0 = no splits, parent.category_id
-- is authoritative). DEFERRABLE so a delete-then-insert atomic replace
-- inside a single BEGIN/COMMIT is valid at commit time.
CREATE OR REPLACE FUNCTION transaction_splits_checksum()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  parent_id      BIGINT;
  parent_amount  NUMERIC(14, 2);
  splits_sum     NUMERIC(14, 2);
BEGIN
  parent_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  SELECT amount INTO parent_amount FROM transactions WHERE id = parent_id;
  IF parent_amount IS NULL THEN
    -- Parent already gone (CASCADE from transactions.DELETE). Nothing to check.
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO splits_sum
    FROM transaction_splits WHERE transaction_id = parent_id;
  IF splits_sum <> 0 AND splits_sum <> parent_amount THEN
    RAISE EXCEPTION
      'transaction_splits sum mismatch: parent=% splits=%',
      parent_amount, splits_sum
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER transaction_splits_checksum_trg
  AFTER INSERT OR UPDATE OR DELETE ON transaction_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transaction_splits_checksum();

-- Amount-lock trigger: reject UPDATE transactions SET amount = ... while
-- the parent has splits. Prevents silent invariant drift.
CREATE OR REPLACE FUNCTION transactions_amount_lock_when_split()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount <> OLD.amount
     AND EXISTS (SELECT 1 FROM transaction_splits
                  WHERE transaction_id = OLD.id) THEN
    RAISE EXCEPTION
      'cannot change transaction amount while splits exist'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transactions_amount_lock_when_split_trg
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_amount_lock_when_split();
```

- [ ] **Step 2: Append the Drizzle table to `schema.ts`**

Edit `backend/src/db/schema.ts`, appending after the `userSettings` table (currently the last table in the file):

```ts
// ---------------------------------------------------------------------------
// transaction_splits — ventilation of one transaction across N (>= 2)
// categories. Sum-of-amounts must equal parent.amount, enforced by a
// deferrable trigger installed in migration 0014. Ownership derived
// transitively via transaction_id (no user_id column needed).
// ---------------------------------------------------------------------------

export const transactionSplits = pgTable(
  'transaction_splits',
  {
    id: serial('id').primaryKey(),
    transactionId: bigserial('transaction_id', { mode: 'number' })
      .notNull(),
    categoryId: integer('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    memo: text('memo'),
  },
  (t) => ({
    idxTx:  index('transaction_splits_tx_idx').on(t.transactionId),
    idxCat: index('transaction_splits_cat_idx').on(t.categoryId),
  }),
);
```

Note: `transactionId` uses `bigserial` in `mode: 'number'` to match `transactions.id` for Drizzle typing — the underlying column is a plain `BIGINT` (no sequence), which the migration already creates. Foreign-key constraint is set in the SQL migration; Drizzle's `.references()` here is optional since we don't use its diff mode.

- [ ] **Step 3: Write the first failing DB test (migration ran, table + triggers exist)**

Create `backend/tests/transaction-splits-route.test.ts`:

```ts
// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountId: number;
let categoryBooksId: number;
let categoryElectroId: number;
let categoryDiversId: number;
let transferAccountId: number;

async function makeTx(payload: Record<string, unknown>): Promise<number> {
  const res = await app.inject({
    method: 'POST', url: '/api/transactions',
    headers: { cookie }, payload,
  });
  if (res.statusCode !== 201) {
    throw new Error(`expected 201 got ${res.statusCode}: ${res.body}`);
  }
  return res.json().transaction.id;
}

describe.skipIf(!RUN)('transaction_splits DB layer', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'splits', password: 'splits-test-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'splits', password: 'splits-test-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const acc = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'Compte', type: 'current', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountId = acc.json().account.id;
    const acc2 = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'Compte2', type: 'current', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    transferAccountId = acc2.json().account.id;

    const mkCat = async (name: string, kind: string) => {
      const c = await app.inject({
        method: 'POST', url: '/api/categories', headers: { cookie },
        payload: { name, kind },
      });
      return c.json().category.id as number;
    };
    categoryBooksId   = await mkCat('Livres',  'expense');
    categoryElectroId = await mkCat('Électro', 'expense');
    categoryDiversId  = await mkCat('DiversTx', 'neutral');
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { transactionSplits, transactions } = await import('../src/db/schema.js');
    await db.delete(transactionSplits);
    await db.delete(transactions);
  });

  it('table + triggers installed by migration 0014', async () => {
    const { db } = await import('../src/db/client.js');
    const { sql } = await import('drizzle-orm');
    const rows = await db.execute<{ tgname: string }>(sql`
      SELECT tgname FROM pg_trigger
       WHERE tgname IN ('transaction_splits_checksum_trg',
                        'transactions_amount_lock_when_split_trg')
       ORDER BY tgname
    `);
    expect(rows.rows.map((r) => r.tgname)).toEqual([
      'transaction_splits_checksum_trg',
      'transactions_amount_lock_when_split_trg',
    ]);
  });

  it('checksum trigger rejects a split-sum mismatch at COMMIT', async () => {
    const { db } = await import('../src/db/client.js');
    const { sql } = await import('drizzle-orm');
    const txId = await makeTx({
      accountId, date: '2026-06-15', amount: '-100.00',
      rawLabel: 'Amazon FR',
    });
    await expect(
      db.execute(sql`
        INSERT INTO transaction_splits (transaction_id, category_id, amount)
        VALUES (${txId}, ${categoryBooksId}, '-40.00'),
               (${txId}, ${categoryElectroId}, '-30.00')
      `),
    ).rejects.toThrow(/sum mismatch/);
  });

  it('amount-lock trigger rejects UPDATE of parent.amount while splits exist', async () => {
    const { db } = await import('../src/db/client.js');
    const { sql } = await import('drizzle-orm');
    const txId = await makeTx({
      accountId, date: '2026-06-16', amount: '-100.00',
      rawLabel: 'Amazon FR',
    });
    await db.execute(sql`
      INSERT INTO transaction_splits (transaction_id, category_id, amount)
      VALUES (${txId}, ${categoryBooksId},   '-60.00'),
             (${txId}, ${categoryElectroId}, '-30.00'),
             (${txId}, ${categoryDiversId},  '-10.00')
    `);
    await expect(
      db.execute(sql`UPDATE transactions SET amount = '-200.00' WHERE id = ${txId}`),
    ).rejects.toThrow(/cannot change transaction amount/);
  });
});
```

- [ ] **Step 4: Run — expect the tests to fail because the migration has not been applied yet**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- transaction-splits-route
```

Expected: three tests fail. The first (`table + triggers installed`) fails because the triggers don't exist yet. The other two fail because inserting into a table that doesn't exist raises `relation "transaction_splits" does not exist`.

If the tests fail with a "cannot find module" error on `../src/db/schema.js`, revisit Step 2 — the Drizzle export is required for the test import chain.

- [ ] **Step 5: Apply the migration**

The project auto-runs migrations at server startup via `backend/src/db/migrate.ts`. Restart the server (or drop and recreate the test database) so migration `0014` runs:

```bash
cd backend && npm run build
# then either restart the dev server, or wipe & re-run migrations in the test DB
```

If the test DB carries state from prior runs (`RUN_DB_TESTS=1` is a live DB), reapply by connecting and issuing:
```sql
DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash LIKE '%0014_transaction_splits%';
```
then re-run — but usually a plain restart is enough.

- [ ] **Step 6: Run — verify the three tests pass**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- transaction-splits-route
```

Expected: all three tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/migrations/0014_transaction_splits.sql \
        backend/src/db/schema.ts \
        backend/tests/transaction-splits-route.test.ts
git commit -m "feat(splits): add transaction_splits table + checksum triggers (0014)"
```

---

## Task 2 — Splits routes (GET / PUT / DELETE)

**Files:**
- Create: `backend/src/http/routes/transactions/splits.ts`
- Modify: `backend/src/http/routes/transactions/index.ts` (register the routes)
- Test: extend `backend/tests/transaction-splits-route.test.ts`

**Interfaces:**
- Consumes: `transactionSplits` from `db/schema.ts` (Task 1). `userId(req)` from `../../plugins/auth.js`.
- Produces:
  - `GET  /api/transactions/:id/splits` → `{ splits: Split[] }` (empty when none).
  - `PUT  /api/transactions/:id/splits` → `{ splits: Split[] }` (atomic replace, min 2 max 20 splits, sum-equals-parent, non-zero same-sign).
  - `DELETE /api/transactions/:id/splits` → `{ deleted: number }`.
  - Serialized shape: `{ id, transactionId, categoryId, amount, memo }`.

- [ ] **Step 1: Write the failing route tests**

Append to `backend/tests/transaction-splits-route.test.ts`, inside the same `describe.skipIf(!RUN)` block (add a nested `describe` for readability):

```ts
describe('splits routes', () => {
  it('GET /:id/splits returns [] when the transaction has no splits', async () => {
    const txId = await makeTx({
      accountId, date: '2026-06-17', amount: '-50.00', rawLabel: 'Foo',
    });
    const res = await app.inject({
      method: 'GET', url: `/api/transactions/${txId}/splits`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().splits).toEqual([]);
  });

  it('PUT /:id/splits with a matching sum inserts them and returns the persisted rows', async () => {
    const txId = await makeTx({
      accountId, date: '2026-06-18', amount: '-100.00', rawLabel: 'Amazon',
    });
    const res = await app.inject({
      method: 'PUT', url: `/api/transactions/${txId}/splits`,
      headers: { cookie },
      payload: {
        splits: [
          { categoryId: categoryBooksId,   amount: '-60.00', memo: 'Kindle' },
          { categoryId: categoryElectroId, amount: '-30.00' },
          { categoryId: categoryDiversId,  amount: '-10.00' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const splits = res.json().splits;
    expect(splits).toHaveLength(3);
    expect(splits[0]).toMatchObject({
      transactionId: txId, categoryId: categoryBooksId, amount: '-60.00', memo: 'Kindle',
    });
    expect(splits.every((s: { id: number }) => Number.isInteger(s.id))).toBe(true);
  });

  it('PUT with sum != parent amount → 400 and no rows written', async () => {
    const txId = await makeTx({
      accountId, date: '2026-06-19', amount: '-100.00', rawLabel: 'Amazon',
    });
    const bad = await app.inject({
      method: 'PUT', url: `/api/transactions/${txId}/splits`,
      headers: { cookie },
      payload: { splits: [
        { categoryId: categoryBooksId, amount: '-40.00' },
        { categoryId: categoryElectroId, amount: '-30.00' },
      ] },
    });
    expect(bad.statusCode).toBe(400);
    const after = await app.inject({
      method: 'GET', url: `/api/transactions/${txId}/splits`, headers: { cookie },
    });
    expect(after.json().splits).toEqual([]);
  });

  it('PUT replaces an existing set atomically', async () => {
    const txId = await makeTx({
      accountId, date: '2026-06-20', amount: '-100.00', rawLabel: 'Amazon',
    });
    await app.inject({
      method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      payload: { splits: [
        { categoryId: categoryBooksId,   amount: '-70.00' },
        { categoryId: categoryElectroId, amount: '-30.00' },
      ] },
    });
    const second = await app.inject({
      method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      payload: { splits: [
        { categoryId: categoryBooksId,  amount: '-50.00' },
        { categoryId: categoryDiversId, amount: '-50.00' },
      ] },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().splits).toHaveLength(2);
    expect(second.json().splits.map((s: { categoryId: number }) => s.categoryId))
      .toEqual([categoryBooksId, categoryDiversId]);
  });

  it('PUT with mixed signs on a negative parent → 400', async () => {
    const txId = await makeTx({
      accountId, date: '2026-06-21', amount: '-100.00', rawLabel: 'Amazon',
    });
    const bad = await app.inject({
      method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      payload: { splits: [
        { categoryId: categoryBooksId,   amount: '-150.00' },
        { categoryId: categoryElectroId, amount:  '50.00' },  // wrong sign
      ] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('PUT with 1 split → 400 (min 2)', async () => {
    const txId = await makeTx({
      accountId, date: '2026-06-22', amount: '-50.00', rawLabel: 'x',
    });
    const bad = await app.inject({
      method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      payload: { splits: [{ categoryId: categoryBooksId, amount: '-50.00' }] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('PUT referencing another user\'s category → 400', async () => {
    // Create a second user and a category owned by them.
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'other', password: 'other-user-1234' },
    });
    const otherLogin = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'other', password: 'other-user-1234' },
    });
    const otherCookie = otherLogin.cookies[0]!.name + '=' + otherLogin.cookies[0]!.value;
    const foreignCat = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie: otherCookie },
      payload: { name: 'ForeignBooks', kind: 'expense' },
    });
    const foreignCatId = foreignCat.json().category.id;

    const txId = await makeTx({
      accountId, date: '2026-06-23', amount: '-100.00', rawLabel: 'Amazon',
    });
    const bad = await app.inject({
      method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      payload: { splits: [
        { categoryId: foreignCatId,     amount: '-60.00' },
        { categoryId: categoryElectroId, amount: '-40.00' },
      ] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('PUT on a zero-amount parent → 400', async () => {
    const txId = await makeTx({
      accountId, date: '2026-06-24', amount: '0.00', rawLabel: 'noop',
    });
    const bad = await app.inject({
      method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      payload: { splits: [
        { categoryId: categoryBooksId,   amount: '0.00' },
        { categoryId: categoryElectroId, amount: '0.00' },
      ] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('DELETE clears splits and restores parent-category-authority', async () => {
    const txId = await makeTx({
      accountId, date: '2026-06-25', amount: '-100.00', rawLabel: 'Amazon',
      categoryId: categoryBooksId,
    });
    await app.inject({
      method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      payload: { splits: [
        { categoryId: categoryElectroId, amount: '-60.00' },
        { categoryId: categoryDiversId,  amount: '-40.00' },
      ] },
    });
    const del = await app.inject({
      method: 'DELETE', url: `/api/transactions/${txId}/splits`, headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted).toBe(2);
    const after = await app.inject({
      method: 'GET', url: `/api/transactions/${txId}/splits`, headers: { cookie },
    });
    expect(after.json().splits).toEqual([]);
  });

  it('deleting the parent transaction cascades to splits', async () => {
    const txId = await makeTx({
      accountId, date: '2026-06-26', amount: '-100.00', rawLabel: 'Amazon',
    });
    await app.inject({
      method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      payload: { splits: [
        { categoryId: categoryBooksId,   amount: '-60.00' },
        { categoryId: categoryElectroId, amount: '-40.00' },
      ] },
    });
    await app.inject({
      method: 'DELETE', url: `/api/transactions/${txId}`, headers: { cookie },
    });
    const { db } = await import('../src/db/client.js');
    const { transactionSplits } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, txId));
    expect(rows).toHaveLength(0);
  });

  it('GET / PUT / DELETE unauthenticated → 401', async () => {
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const res = await app.inject({
        method, url: `/api/transactions/1/splits`,
        ...(method === 'PUT' ? { payload: { splits: [] } } : {}),
      });
      expect(res.statusCode).toBe(401);
    }
  });
});
```

- [ ] **Step 2: Run — expect ALL new tests to fail with 404 (routes not registered)**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- transaction-splits-route
```

Expected: the "splits routes" describe block fails; each test hits a 404 or the injected app throws because the route is not registered.

- [ ] **Step 3: Create the splits route file**

Create `backend/src/http/routes/transactions/splits.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { categories, transactions, transactionSplits } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { isPgError, parseId } from './helpers.js';

const SplitInput = z.object({
  categoryId: z.number().int().positive(),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
  memo: z.string().max(200).nullable().optional(),
});
const PutBody = z.object({
  splits: z.array(SplitInput).min(2).max(20),
});

// Fixed-point compare via cents. Node's Number is fine for values within
// numeric(14,2)'s range — we only need integer equality after *100 rounding.
function toCents(s: string): number {
  return Math.round(Number(s) * 100);
}

function serialize(row: typeof transactionSplits.$inferSelect) {
  return {
    id: row.id,
    transactionId: row.transactionId,
    categoryId: row.categoryId,
    amount: row.amount,
    memo: row.memo,
  };
}

async function loadOwnedTransaction(uid: number, txId: number) {
  const [row] = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      transferGroupId: transactions.transferGroupId,
    })
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.userId, uid)));
  return row ?? null;
}

export function registerSplitsRoutes(app: FastifyInstance): void {
  app.get('/api/transactions/:id/splits', async (req, reply) => {
    const uid = userId(req);
    const txId = parseId(req, reply);
    if (txId === null) return;
    const parent = await loadOwnedTransaction(uid, txId);
    if (!parent) return reply.code(404).send({ error: 'not found' });
    const rows = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, txId));
    return { splits: rows.map(serialize) };
  });

  app.put('/api/transactions/:id/splits', async (req, reply) => {
    const uid = userId(req);
    const txId = parseId(req, reply);
    if (txId === null) return;
    const parent = await loadOwnedTransaction(uid, txId);
    if (!parent) return reply.code(404).send({ error: 'not found' });

    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const splits = parsed.data.splits;

    if (parent.transferGroupId !== null) {
      return reply.code(400).send({ error: "un virement interne ne peut pas être ventilé" });
    }
    const parentCents = toCents(parent.amount);
    if (parentCents === 0) {
      return reply.code(400).send({ error: 'le montant de la transaction est nul' });
    }

    // Sign guard + non-zero.
    for (const s of splits) {
      const c = toCents(s.amount);
      if (c === 0) {
        return reply.code(400).send({ error: 'chaque ventilation doit avoir un montant non nul' });
      }
      if ((parentCents < 0) !== (c < 0)) {
        return reply.code(400).send({ error: 'le signe de chaque ventilation doit correspondre à celui de la transaction' });
      }
    }

    // Sum guard (belt-and-suspenders with the trigger — friendlier French error).
    const sumCents = splits.reduce((acc, s) => acc + toCents(s.amount), 0);
    if (sumCents !== parentCents) {
      return reply.code(400).send({
        error: 'la somme des ventilations ne correspond pas au montant de la transaction',
      });
    }

    // Category ownership: every categoryId must belong to the caller.
    const wanted = Array.from(new Set(splits.map((s) => s.categoryId)));
    const owned = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, uid)));
    const ownedSet = new Set(owned.map((c) => c.id));
    for (const wid of wanted) {
      if (!ownedSet.has(wid)) {
        return reply.code(400).send({ error: 'catégorie inconnue' });
      }
    }

    try {
      const inserted = await db.transaction(async (tx) => {
        await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, txId));
        const rows = await tx
          .insert(transactionSplits)
          .values(splits.map((s) => ({
            transactionId: txId,
            categoryId: s.categoryId,
            amount: Number(s.amount).toFixed(2),
            memo: s.memo && s.memo.trim() ? s.memo : null,
          })))
          .returning();
        return rows;
      });
      return { splits: inserted.map(serialize) };
    } catch (err) {
      if (isPgError(err) && err.code === '23514') {
        return reply.code(400).send({
          error: 'la somme des ventilations ne correspond pas au montant de la transaction',
        });
      }
      throw err;
    }
  });

  app.delete('/api/transactions/:id/splits', async (req, reply) => {
    const uid = userId(req);
    const txId = parseId(req, reply);
    if (txId === null) return;
    const parent = await loadOwnedTransaction(uid, txId);
    if (!parent) return reply.code(404).send({ error: 'not found' });
    const deleted = await db
      .delete(transactionSplits)
      .where(eq(transactionSplits.transactionId, txId))
      .returning({ id: transactionSplits.id });
    return { deleted: deleted.length };
  });
}
```

- [ ] **Step 4: Register the routes from `transactions/index.ts`**

Edit `backend/src/http/routes/transactions/index.ts`. Add the import:

```ts
import { registerSplitsRoutes } from './splits.js';
```

Then in the `transactionsRoutes` function body, next to the existing `registerDuplicateRoutes(app);` call, add:

```ts
  registerSplitsRoutes(app);
```

- [ ] **Step 5: Run — expect all splits-routes tests to pass**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- transaction-splits-route
```

Expected: every test passes, including the twelve new ones under "splits routes".

- [ ] **Step 6: Commit**

```bash
git add backend/src/http/routes/transactions/splits.ts \
        backend/src/http/routes/transactions/index.ts \
        backend/tests/transaction-splits-route.test.ts
git commit -m "feat(splits): add GET/PUT/DELETE /api/transactions/:id/splits"
```

---

## Task 3 — Hydrate `splits: []` on transactions GET responses

**Files:**
- Modify: `backend/src/http/routes/transactions/index.ts` (extend GET list + GET single-row handlers)
- Test: extend `backend/tests/transaction-splits-route.test.ts`

**Interfaces:**
- Produces: every row returned from `GET /api/transactions` and `GET /api/transactions/:id` now carries `splits: TransactionSplit[]` (empty when none).

- [ ] **Step 1: Write the failing test**

Append inside the "splits routes" `describe` block:

```ts
it('GET /api/transactions hydrates splits: [] and the split rows', async () => {
  const txIdPlain = await makeTx({
    accountId, date: '2026-06-27', amount: '-25.00', rawLabel: 'coffee',
  });
  const txIdSplit = await makeTx({
    accountId, date: '2026-06-27', amount: '-100.00', rawLabel: 'Amazon',
  });
  await app.inject({
    method: 'PUT', url: `/api/transactions/${txIdSplit}/splits`, headers: { cookie },
    payload: { splits: [
      { categoryId: categoryBooksId,   amount: '-60.00' },
      { categoryId: categoryElectroId, amount: '-40.00' },
    ] },
  });
  const list = await app.inject({
    method: 'GET',
    url: `/api/transactions?accountId=${accountId}&fromDate=2026-06-27&toDate=2026-06-27`,
    headers: { cookie },
  });
  expect(list.statusCode).toBe(200);
  const txns = list.json().transactions as Array<{ id: number; splits: unknown[] }>;
  const plain = txns.find((t) => t.id === txIdPlain)!;
  const split = txns.find((t) => t.id === txIdSplit)!;
  expect(plain.splits).toEqual([]);
  expect(split.splits).toHaveLength(2);
  expect(split.splits[0]).toMatchObject({
    transactionId: txIdSplit, categoryId: categoryBooksId, amount: '-60.00',
  });

  const single = await app.inject({
    method: 'GET', url: `/api/transactions/${txIdSplit}`, headers: { cookie },
  });
  expect(single.json().transaction.splits).toHaveLength(2);
});
```

- [ ] **Step 2: Run — expect the test to fail on `undefined.splits` / missing field**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- transaction-splits-route
```

Expected: this one test fails because the response rows don't yet carry `splits`.

- [ ] **Step 3: Extract a hydration helper and use it in both handlers**

Edit `backend/src/http/routes/transactions/index.ts`. Add these imports (extend the existing lines):

```ts
import { transactions, transactionSplits } from '../../../db/schema.js';
```

Add this helper at module scope, just below the imports:

```ts
async function hydrateSplits<T extends { id: number }>(rows: T[]): Promise<Array<T & { splits: Array<{
  id: number; transactionId: number; categoryId: number | null; amount: string; memo: string | null;
}> }>> {
  if (rows.length === 0) return rows.map((r) => ({ ...r, splits: [] }));
  const ids = rows.map((r) => r.id);
  const splits = await db
    .select()
    .from(transactionSplits)
    .where(inArray(transactionSplits.transactionId, ids));
  const byTx = new Map<number, Array<typeof splits[number]>>();
  for (const s of splits) {
    const arr = byTx.get(s.transactionId) ?? [];
    arr.push(s);
    byTx.set(s.transactionId, arr);
  }
  return rows.map((r) => ({
    ...r,
    splits: (byTx.get(r.id) ?? []).map((s) => ({
      id: s.id,
      transactionId: s.transactionId,
      categoryId: s.categoryId,
      amount: s.amount,
      memo: s.memo,
    })),
  }));
}
```

Then update the `GET /api/transactions` handler — replace the final `return { transactions: rows, pagination: ... }` with:

```ts
    const hydrated = await hydrateSplits(rows);
    return {
      transactions: hydrated,
      pagination: { total, limit: q.limit, offset: q.offset },
    };
```

And in `GET /api/transactions/:id`, replace `return { transaction: row };` with:

```ts
    const [hydrated] = await hydrateSplits([row]);
    return { transaction: hydrated };
```

- [ ] **Step 4: Run — expect all tests to pass**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- transaction-splits-route
```

Expected: every test passes, including the new hydration test.

Also run the pre-existing transaction route tests to confirm nothing regressed:

```bash
cd backend && RUN_DB_TESTS=1 npm test -- transactions-route
```

Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/transactions/index.ts \
        backend/tests/transaction-splits-route.test.ts
git commit -m "feat(splits): hydrate splits on GET /api/transactions responses"
```

---

## Task 4 — PATCH amount-lock 409

**Files:**
- Modify: `backend/src/http/routes/transactions/index.ts` (PATCH `try/catch`)
- Test: extend `backend/tests/transaction-splits-route.test.ts`

**Interfaces:**
- Produces: `PATCH /api/transactions/:id` with `amount` returns 409 when the transaction has splits, leaving parent and splits unchanged. Other PATCH fields (categoryId, notes…) are unaffected.

- [ ] **Step 1: Write the failing test**

Append inside "splits routes":

```ts
it('PATCH amount on a split transaction → 409, no changes applied', async () => {
  const txId = await makeTx({
    accountId, date: '2026-06-28', amount: '-100.00', rawLabel: 'Amazon',
  });
  await app.inject({
    method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
    payload: { splits: [
      { categoryId: categoryBooksId,  amount: '-60.00' },
      { categoryId: categoryDiversId, amount: '-40.00' },
    ] },
  });
  const bad = await app.inject({
    method: 'PATCH', url: `/api/transactions/${txId}`, headers: { cookie },
    payload: { amount: '-200.00' },
  });
  expect(bad.statusCode).toBe(409);
  const after = await app.inject({
    method: 'GET', url: `/api/transactions/${txId}`, headers: { cookie },
  });
  expect(after.json().transaction.amount).toBe('-100.00');
});

it('PATCH notes on a split transaction still succeeds (no trigger involvement)', async () => {
  const txId = await makeTx({
    accountId, date: '2026-06-29', amount: '-100.00', rawLabel: 'Amazon',
  });
  await app.inject({
    method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
    payload: { splits: [
      { categoryId: categoryBooksId,  amount: '-60.00' },
      { categoryId: categoryDiversId, amount: '-40.00' },
    ] },
  });
  const ok = await app.inject({
    method: 'PATCH', url: `/api/transactions/${txId}`, headers: { cookie },
    payload: { notes: 'kindle + livraison' },
  });
  expect(ok.statusCode).toBe(200);
});
```

- [ ] **Step 2: Run — expect the 409 test to fail (currently returns 500 or bubbles as unhandled)**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- transaction-splits-route
```

Expected: the 409 test fails with a 500 (or similar); the notes test may pass or fail depending on whether the PATCH order surfaced the trigger.

- [ ] **Step 3: Add the 23514 branch to the PATCH catch**

Edit `backend/src/http/routes/transactions/index.ts`. The `PATCH /api/transactions/:id` handler ends with:

```ts
    } catch (err) {
      if (isPgError(err) && err.code === '23503') {
        return reply.code(400).send({ error: 'compte ou catégorie inconnu' });
      }
      throw err;
    }
```

Replace with:

```ts
    } catch (err) {
      if (isPgError(err) && err.code === '23503') {
        return reply.code(400).send({ error: 'compte ou catégorie inconnu' });
      }
      if (isPgError(err) && err.code === '23514') {
        return reply.code(409).send({
          error: "supprimez d'abord la ventilation avant de modifier le montant",
        });
      }
      throw err;
    }
```

- [ ] **Step 4: Run — expect all tests to pass**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- transaction-splits-route
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/transactions/index.ts \
        backend/tests/transaction-splits-route.test.ts
git commit -m "feat(splits): 409 on PATCH amount when transaction has splits"
```

---

## Task 5 — `?categoryId=X` filter includes splits

**Files:**
- Modify: `backend/src/http/routes/transactions/index.ts` (GET list handler, `categoryId` filter)
- Test: extend `backend/tests/transaction-splits-route.test.ts`

**Interfaces:**
- Produces: `GET /api/transactions?categoryId=X` returns transactions where `t.category_id = X` OR any of the transaction's splits targets category X.

- [ ] **Step 1: Write the failing test**

Append inside "splits routes":

```ts
it('GET /api/transactions?categoryId=X includes split-only matches', async () => {
  const plainTx = await makeTx({
    accountId, date: '2026-07-01', amount: '-40.00', rawLabel: 'plain Livres',
    categoryId: categoryBooksId,
  });
  const splitTx = await makeTx({
    accountId, date: '2026-07-02', amount: '-100.00', rawLabel: 'Amazon',
  });
  await app.inject({
    method: 'PUT', url: `/api/transactions/${splitTx}/splits`, headers: { cookie },
    payload: { splits: [
      { categoryId: categoryBooksId,   amount: '-60.00' },
      { categoryId: categoryElectroId, amount: '-40.00' },
    ] },
  });

  const list = await app.inject({
    method: 'GET',
    url: `/api/transactions?categoryId=${categoryBooksId}`,
    headers: { cookie },
  });
  expect(list.statusCode).toBe(200);
  const ids = (list.json().transactions as Array<{ id: number }>).map((t) => t.id).sort();
  expect(ids).toEqual([plainTx, splitTx].sort());
});
```

- [ ] **Step 2: Run — expect the split-only match to be missing**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- transaction-splits-route
```

Expected: assertion fails, the split-tx id is not in `ids`.

- [ ] **Step 3: Extend the categoryId filter**

Edit `backend/src/http/routes/transactions/index.ts`. Locate:

```ts
    if (q.categoryId) where.push(eq(transactions.categoryId, q.categoryId));
```

Replace with:

```ts
    if (q.categoryId) {
      // Match plain-category transactions OR transactions with any split
      // targeting the wanted category. Keeps the "Livres" filter honest
      // when a Livres split lives on an Amazon transaction whose own
      // category_id points elsewhere (or is null).
      where.push(sql`(
        ${transactions.categoryId} = ${q.categoryId}
        OR EXISTS (
          SELECT 1 FROM ${transactionSplits} s
           WHERE s.transaction_id = ${transactions.id}
             AND s.category_id = ${q.categoryId}
        )
      )`);
    }
```

- [ ] **Step 4: Run — expect the test to pass**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- transaction-splits-route transactions-route
```

Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/transactions/index.ts \
        backend/tests/transaction-splits-route.test.ts
git commit -m "feat(splits): list filter categoryId includes split matches"
```

---

## Task 6 — Split-aware `/api/reports/categories`

**Files:**
- Modify: `backend/src/http/routes/reports.ts`
- Test: extend `backend/tests/reports-route.test.ts` (or add to `transaction-splits-route.test.ts` if you prefer to co-locate — put it in the reports test file to match the existing organisation)

**Interfaces:**
- Produces: `/api/reports/categories` returns totals derived from a CTE that treats each split as its own effective row and unsplit transactions as their own effective rows.

- [ ] **Step 1: Read the existing reports test file to match its beforeAll shape**

Read `backend/tests/reports-route.test.ts` end-to-end to learn the fixture pattern (accounts, categories, cookie). Add the following test at the bottom of the main `describe.skipIf(!RUN)` block (adjust variable names to match what's already declared in that file — the test below assumes `accountId`, `expenseCategoryId`, and helper `makeTx`; use the existing names verbatim):

```ts
it('splits contribute to their split category, parent contributes nothing', async () => {
  const { db } = await import('../src/db/client.js');
  const { sql } = await import('drizzle-orm');

  // 1) Create a plain -50 tx tagged to expenseCategoryId (baseline).
  const plainId = await makeTx({
    accountId, date: '2026-06-15', amount: '-50.00',
    rawLabel: 'plain', categoryId: expenseCategoryId,
  });
  // 2) Create a -100 tx whose own category points at expenseCategoryId but
  //    whose SPLITS ignore it — the split subtotal for expenseCategoryId
  //    must NOT count the parent's own attribution.
  const splitTxId = await makeTx({
    accountId, date: '2026-06-15', amount: '-100.00',
    rawLabel: 'Amazon', categoryId: expenseCategoryId,
  });
  const [otherCat] = await db.execute<{ id: number }>(sql`
    INSERT INTO categories (user_id, name, kind, is_default)
    VALUES ((SELECT id FROM users WHERE username = 'reports'), 'OtherCat', 'expense', false)
    RETURNING id
  `);
  await app.inject({
    method: 'PUT', url: `/api/transactions/${splitTxId}/splits`, headers: { cookie },
    payload: { splits: [
      { categoryId: otherCat.id,          amount: '-70.00' },
      { categoryId: expenseCategoryId,    amount: '-30.00' },
    ] },
  });

  const res = await app.inject({
    method: 'GET', url: '/api/reports/categories?fromDate=2026-06-01&toDate=2026-06-30',
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
  const rows = res.json().rows as Array<{ category_id: number; total: string }>;
  const expense = rows.find((r) => r.category_id === expenseCategoryId)!;
  const other   = rows.find((r) => r.category_id === otherCat.id)!;
  // -50 (plain) + -30 (split contribution) = -80
  expect(Number(expense.total)).toBeCloseTo(-80.0, 2);
  // -70 from the split
  expect(Number(other.total)).toBeCloseTo(-70.0, 2);
});
```

If the existing file doesn't declare a `makeTx` helper, mirror the one from `transaction-splits-route.test.ts`. Adjust the OtherCat insertion so it uses the actual username seeded in the reports test (`reports` here is illustrative).

- [ ] **Step 2: Run — expect the test to fail (parent's -100 is still being attributed)**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- reports-route
```

Expected: `expense.total` is `-150` (=-50-100) instead of `-80`, and `other` is undefined.

- [ ] **Step 3: Rewrite the SQL to the split-aware CTE**

Edit `backend/src/http/routes/reports.ts`. Replace the query in `GET /api/reports/categories` with:

```ts
    const rows = await db.execute<{
      category_id: number | null;
      category_name: string | null;
      category_kind: string | null;
      category_is_internal_transfer: boolean | null;
      month: string;
      total: string;
      transaction_count: number;
    }>(sql`
      WITH tx_effective AS (
        SELECT t.id, t.user_id, t.account_id, t.date, t.transfer_group_id,
               t.category_id, t.amount
          FROM transactions t
         WHERE NOT EXISTS (
           SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id
         )
        UNION ALL
        SELECT t.id, t.user_id, t.account_id, t.date, t.transfer_group_id,
               s.category_id, s.amount
          FROM transactions t
          JOIN transaction_splits s ON s.transaction_id = t.id
      )
      SELECT
        c.id AS category_id,
        c.name AS category_name,
        c.kind AS category_kind,
        c.is_internal_transfer AS category_is_internal_transfer,
        to_char(date_trunc('month', e.date::timestamp), 'YYYY-MM') AS month,
        SUM(e.amount)::text AS total,
        COUNT(*)::int AS transaction_count
      FROM tx_effective e
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.user_id = ${uid}
        AND e.transfer_group_id IS NULL
        ${fromDate ? sql`AND e.date >= ${fromDate}` : sql``}
        ${toDate ? sql`AND e.date <= ${toDate}` : sql``}
        ${accountId ? sql`AND e.account_id = ${accountId}` : sql``}
      GROUP BY c.id, c.name, c.kind, month
      ORDER BY month DESC, total ASC
    `);
```

Note: `transaction_count` now counts virtual rows (a 3-way split contributes 3). Add a two-line comment above the CTE explaining this so future readers don't "fix" it.

- [ ] **Step 4: Run — expect the test to pass**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- reports-route
```

Expected: green. Also re-run the full backend suite to catch any collateral damage:

```bash
cd backend && RUN_DB_TESTS=1 npm test
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/reports.ts \
        backend/tests/reports-route.test.ts
git commit -m "feat(splits): /api/reports/categories aggregates over splits"
```

---

## Task 7 — Split-aware `/api/tri/groups`

**Files:**
- Modify: `backend/src/http/routes/tri.ts`
- Test: extend `backend/tests/tri-route.test.ts`

**Interfaces:**
- Produces: `/api/tri/groups` no longer surfaces a transaction that has splits — a fully-ventilated row has effectively been categorized, per row.

Semantic: a **transaction with splits** is treated as categorized regardless of what `t.category_id` and `t.category_source` say. The existing "Divers / default / null" filter must skip rows that have splits.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/tri-route.test.ts` (using the file's existing fixtures):

```ts
it('groups exclude transactions that have splits', async () => {
  // Baseline: an uncategorized transaction should appear.
  const bareId = await makeTx({
    accountId, date: '2026-07-03', amount: '-9.99', rawLabel: 'newthing 42',
  });
  const groupsBefore = await app.inject({
    method: 'GET', url: '/api/tri/groups', headers: { cookie },
  });
  const labelsBefore = (groupsBefore.json().groups as Array<{ normalized_label: string }>)
    .map((g) => g.normalized_label);
  expect(labelsBefore).toContain('newthing');

  // Add splits — the row should now be considered categorized.
  await app.inject({
    method: 'PUT', url: `/api/transactions/${bareId}/splits`, headers: { cookie },
    payload: { splits: [
      { categoryId: expenseCategoryId, amount: '-5.99' },
      { categoryId: neutralCategoryId, amount: '-4.00' },
    ] },
  });
  const groupsAfter = await app.inject({
    method: 'GET', url: '/api/tri/groups', headers: { cookie },
  });
  const labelsAfter = (groupsAfter.json().groups as Array<{ normalized_label: string }>)
    .map((g) => g.normalized_label);
  expect(labelsAfter).not.toContain('newthing');
});
```

If the tri test file doesn't already have `neutralCategoryId` or an "expense" one, add them to the `beforeAll` fixture.

- [ ] **Step 2: Run — expect it to fail (the split row is still returned)**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- tri-route
```

Expected: `labelsAfter` still contains `newthing`.

- [ ] **Step 3: Add the `NOT EXISTS (transaction_splits)` guard**

Edit `backend/src/http/routes/tri.ts`. In the two SQL blocks — the groups query and the totals query — replace the `WHERE` clauses:

```sql
      WHERE t.user_id = ${uid}
        AND t.transfer_group_id IS NULL
        AND (t.category_id IS NULL OR c.is_default = TRUE OR t.category_source = 'default')
```

with:

```sql
      WHERE t.user_id = ${uid}
        AND t.transfer_group_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
        AND (t.category_id IS NULL OR c.is_default = TRUE OR t.category_source = 'default')
```

Apply this in both queries in `/api/tri/groups`.

Do not touch `/api/tri/assign` — that endpoint mutates `t.category_id` and its filter is fine (splits are ignored on assignment; if the user tries to bulk-assign a normalized_label that includes a split row, the UPDATE just updates the parent's `category_id`, which stays inert while splits exist. Acceptable.).

- [ ] **Step 4: Run — expect green**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- tri-route
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/tri.ts backend/tests/tri-route.test.ts
git commit -m "feat(splits): exclude split transactions from tri groups"
```

---

## Task 8 — Backup v2 (schema bump, export, restore)

**Files:**
- Modify: `backend/src/http/routes/backup/schema.ts` (VERSION 1→2, per-transaction `splits`)
- Modify: `backend/src/http/routes/backup/export.ts` (emit splits)
- Modify: `backend/src/http/routes/backup/restore.ts` (insert splits)
- Test: extend `backend/tests/backup-route.test.ts`

**Interfaces:**
- Consumes: `transactionSplits` schema.
- Produces: `dump.version === 2`, each transaction may carry `splits: Array<{ category: string | null; amount: string; memo?: string | null }>`. Restore accepts both v1 (no splits) and v2.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/backup-route.test.ts` (use the file's existing fixtures — the reference below assumes helpers similar to the other backend tests, adapt to what's actually there):

```ts
it('exports splits as v2 and re-imports them intact', async () => {
  // Assumes beforeAll seeded accountId + one expense category.
  const txId = await makeTx({
    accountId, date: '2026-07-04', amount: '-100.00', rawLabel: 'Amazon FR',
  });
  await app.inject({
    method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
    payload: { splits: [
      { categoryId: expenseCategoryId, amount: '-60.00', memo: 'Kindle' },
      { categoryId: neutralCategoryId, amount: '-40.00' },
    ] },
  });

  const exported = await app.inject({
    method: 'GET', url: '/api/backup/export', headers: { cookie },
  });
  const dump = exported.json();
  expect(dump.version).toBe(2);
  const dumpedTx = (dump.transactions as Array<{ dedupKey: string; splits?: unknown[] }>)
    .find((t) => t.dedupKey !== undefined && (t as { rawLabel: string }).rawLabel === 'Amazon FR')!;
  expect(dumpedTx.splits).toHaveLength(2);

  // Restore into the same account (REPLACE semantics wipes and reinserts).
  const restored = await app.inject({
    method: 'POST', url: '/api/backup/import', headers: { cookie },
    payload: dump,
  });
  expect(restored.statusCode).toBe(200);

  // Fetch again and confirm the split survived.
  const list = await app.inject({
    method: 'GET', url: `/api/transactions?fromDate=2026-07-04&toDate=2026-07-04`,
    headers: { cookie },
  });
  const roundTripped = (list.json().transactions as Array<{
    rawLabel: string; splits: Array<{ amount: string }>;
  }>).find((t) => t.rawLabel === 'Amazon FR')!;
  expect(roundTripped.splits).toHaveLength(2);
  expect(roundTripped.splits.map((s) => s.amount).sort())
    .toEqual(['-40.00', '-60.00']);
});

it('imports a v1 dump without splits cleanly', async () => {
  const v1: Record<string, unknown> = {
    version: 1,
    accounts: [{
      name: 'From-v1', type: 'current', currency: 'EUR',
      openingBalance: '0', openingDate: '2025-01-01',
    }],
    categories: [{ name: 'Divers', kind: 'neutral', isDefault: true }],
    accountFilenamePatterns: [],
    rules: [],
    transactions: [{
      account: 'From-v1', date: '2026-01-01', amount: '-10.00',
      rawLabel: 'x', normalizedLabel: 'x', dedupKey: 'v1-dk',
      categorySource: 'auto',
    }],
  };
  const res = await app.inject({
    method: 'POST', url: '/api/backup/import', headers: { cookie }, payload: v1,
  });
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 2: Run — expect failures (v1 export vs. v2 assertion, restore rejects v2)**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- backup-route
```

Expected: the round-trip test fails; the v1-dump test likely still passes.

- [ ] **Step 3: Bump the schema**

Edit `backend/src/http/routes/backup/schema.ts`. Change `VERSION`:

```ts
export const VERSION = 2;
```

Change the version literal to a union:

```ts
export const BackupBody = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  // ...
```

Inside the `transactions` array item shape, add the optional `splits` field:

```ts
  transactions: z.array(
    z.object({
      // ...existing fields unchanged...
      splits: z.array(
        z.object({
          category: z.string().nullable(),
          amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
          memo: z.string().nullable().optional(),
        }),
      ).optional(),
    }),
  ),
```

- [ ] **Step 4: Emit splits from export**

Edit `backend/src/http/routes/backup/export.ts`.

Add imports:

```ts
import { transactionSplits } from '../../../db/schema.js';
```

Extend the `Promise.all` to fetch splits, and build a per-tx-id map:

```ts
    const [accs, cats, patterns, rls, txs, fimps, checkpoints, splits] = await Promise.all([
      db.select().from(accounts).where(eq(accounts.userId, uid)),
      db.select().from(categories).where(eq(categories.userId, uid)),
      db.select().from(accountFilenamePatterns).where(eq(accountFilenamePatterns.userId, uid)),
      db.select().from(rules).where(eq(rules.userId, uid)),
      db.select().from(transactions).where(eq(transactions.userId, uid)),
      db.select().from(fileImports).where(eq(fileImports.userId, uid)),
      db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.userId, uid)),
      // Splits scoped implicitly by the transactions join above; a plain scan
      // here is fine because the DB constraint enforces per-user consistency
      // via CASCADE from transactions.user_id.
      db
        .select()
        .from(transactionSplits)
        .innerJoin(transactions, eq(transactionSplits.transactionId, transactions.id))
        .where(eq(transactions.userId, uid))
        .then((rows) => rows.map((r) => r.transaction_splits)),
    ]);
```

Below the existing `fileImportById` map, add:

```ts
    const splitsByTx = new Map<number, Array<typeof splits[number]>>();
    for (const s of splits) {
      const arr = splitsByTx.get(s.transactionId) ?? [];
      arr.push(s);
      splitsByTx.set(s.transactionId, arr);
    }
```

Then in the transactions map — replace the return object with:

```ts
      transactions: txs.map((t) => {
        const src = t.sourceFileId ? fileImportById.get(t.sourceFileId) : undefined;
        const rows = splitsByTx.get(t.id) ?? [];
        return {
          account: accountById.get(t.accountId)?.name ?? null,
          date: t.date,
          amount: t.amount,
          rawLabel: t.rawLabel,
          normalizedLabel: t.normalizedLabel,
          memo: t.memo,
          notes: t.notes,
          fitid: t.fitid,
          dedupKey: t.dedupKey,
          category: t.categoryId ? categoryById.get(t.categoryId)?.name ?? null : null,
          categorySource: t.categorySource,
          transferGroupId: t.transferGroupId,
          sourceFileKey: src ? fileImportKey(src.filename, src.importedAt.toISOString()) : null,
          notDuplicate: t.notDuplicate,
          lockYears: t.lockYears,
          splits: rows.length === 0 ? undefined : rows.map((s) => ({
            category: s.categoryId ? categoryById.get(s.categoryId)?.name ?? null : null,
            amount: s.amount,
            memo: s.memo,
          })),
        };
      }),
```

- [ ] **Step 5: Insert splits during restore**

Edit `backend/src/http/routes/backup/restore.ts`.

Add import:

```ts
import { transactionSplits } from '../../../db/schema.js';
```

Wipe splits ahead of transactions:

```ts
      // Wipe only THIS user's rows, in reverse dependency order.
      // Splits die via CASCADE when their parent transactions get wiped
      // below, but we drop them explicitly to keep the ordering readable.
      await tx.delete(transactionSplits)
        .where(sql`transaction_id IN (SELECT id FROM transactions WHERE user_id = ${uid})`);
      await tx.delete(transactions).where(eq(transactions.userId, uid));
      // ... rest unchanged ...
```

Add `sql` to the drizzle-orm import:

```ts
import { and, eq, sql } from 'drizzle-orm';
```

Then inside the transactions loop, after `await tx.insert(transactions).values({...})`, capture the returned id and insert its splits. Change the transactions insert block:

```ts
      let txCount = 0;
      for (const t of dump.transactions) {
        const accId = accountIdByName.get(t.account);
        if (!accId) continue;
        const catId = t.category ? categoryIdByName.get(t.category) ?? null : null;
        const srcId = t.sourceFileKey ? fileImportIdByKey.get(t.sourceFileKey) ?? null : null;
        const [insertedTx] = await tx.insert(transactions).values({
          userId: uid,
          accountId: accId,
          date: t.date,
          amount: t.amount,
          rawLabel: t.rawLabel,
          normalizedLabel: t.normalizedLabel,
          memo: t.memo ?? null,
          notes: t.notes ?? null,
          fitid: t.fitid ?? null,
          dedupKey: t.dedupKey,
          categoryId: catId,
          categorySource: t.categorySource,
          transferGroupId: t.transferGroupId ?? null,
          sourceFileId: srcId,
          notDuplicate: true,
          lockYears: t.lockYears ?? null,
        }).returning({ id: transactions.id });
        txCount++;

        if (insertedTx && t.splits && t.splits.length > 0) {
          const rows = t.splits.map((s) => ({
            transactionId: insertedTx.id,
            categoryId: s.category ? categoryIdByName.get(s.category) ?? null : null,
            amount: s.amount,
            memo: s.memo ?? null,
          }));
          await tx.insert(transactionSplits).values(rows);
        }
      }
```

The deferred trigger fires once at COMMIT per parent — the sums are already balanced in the dump so the check passes.

- [ ] **Step 6: Run — expect the round-trip test to pass**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npm test -- backup-route
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/http/routes/backup/schema.ts \
        backend/src/http/routes/backup/export.ts \
        backend/src/http/routes/backup/restore.ts \
        backend/tests/backup-route.test.ts
git commit -m "feat(splits): backup v2 emits and restores transaction splits"
```

---

## Task 9 — Frontend types

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/pages/Transactions/__tests__/TransactionModal.test.tsx` (fixture includes `splits: []`)
- Modify: `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx` (fixture includes `splits: []`)

**Interfaces:**
- Produces:
  - `TransactionSplit { id, transactionId, categoryId: number | null, amount: string, memo: string | null }`.
  - `Transaction` gains `splits: TransactionSplit[]` (required — `[]` when none).

- [ ] **Step 1: Add the type**

Edit `frontend/src/api/types.ts`. Append `TransactionSplit` just before the existing `Transaction` interface, then extend `Transaction`:

```ts
export interface TransactionSplit {
  id: number;
  transactionId: number;
  categoryId: number | null;
  amount: string;      // signed decimal-2, matches parent's sign
  memo: string | null;
}

export interface Transaction {
  id: number;
  accountId: number;
  date: string;
  amount: string;
  rawLabel: string;
  normalizedLabel: string;
  memo: string | null;
  notes: string | null;
  fitid: string | null;
  dedupKey: string;
  categoryId: number | null;
  categorySource: CategorySource;
  transferGroupId: string | null;
  sourceFileId: number | null;
  importedAt: string;
  lockYears?: number | null;
  splits: TransactionSplit[];
}
```

- [ ] **Step 2: Fix existing fixtures**

Edit `frontend/src/pages/Transactions/__tests__/TransactionModal.test.tsx`. The `original` Transaction literal is missing `splits`. Add `splits: []` to it.

Edit `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`. Grep for `Transaction` literals in that file and add `splits: []` to each.

- [ ] **Step 3: Run frontend tests to confirm no type / runtime regression**

Run:
```bash
cd frontend && npm test -- --run
```

Expected: all frontend tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts \
        frontend/src/pages/Transactions/__tests__/TransactionModal.test.tsx \
        frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx
git commit -m "feat(splits): add TransactionSplit type + extend Transaction"
```

---

## Task 10 — SplitEditor component

**Files:**
- Create: `frontend/src/pages/Transactions/SplitEditor.tsx`
- Create: `frontend/src/pages/Transactions/__tests__/SplitEditor.test.tsx`

**Interfaces:**
- Produces `<SplitEditor>` accepting:
  ```ts
  {
    parentAmountMagnitude: number;       // absolute value of the parent amount in EUR
    parentAmountSign: -1 | 1 | 0;        // 0 when the parent field is empty/zero
    disabled?: boolean;                  // e.g. transfer legs
    initial: TransactionSplit[];         // hydrated from the parent transaction
    categories: Category[];
    onChange: (splits: DraftSplit[]) => void;   // fired on every draft mutation
  }
  ```
  and exporting `type DraftSplit = { key: string; categoryId: number | ''; amountMagnitude: string; memo: string }`.
- Behaviour:
  - Empty initial → renders the collapsed `[+ Ventiler cette transaction]` button.
  - Click `+` → seeds two rows (first row typed by user, second is `parentAmountMagnitude - first`).
  - Adding rows rebalances by moving the delta into the last row.
  - Removing a row moves its magnitude into the last remaining row.
  - "Reste à ventiler" chip: `red` when non-zero, `sage` when zero (compared as cents).
  - Disabled with an inline hint when `disabled` is true.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/Transactions/__tests__/SplitEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplitEditor, type DraftSplit } from '../SplitEditor';
import type { Category } from '../../../api/types';

const cats: Category[] = [
  { id: 10, name: 'Livres',  kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 11, name: 'Électro', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 12, name: 'Divers',  kind: 'neutral', color: null, parentId: null, isDefault: true,  isInternalTransfer: false },
];

function renderEditor(overrides: Partial<React.ComponentProps<typeof SplitEditor>> = {}) {
  const onChange = vi.fn<[DraftSplit[]], void>();
  const utils = render(
    <SplitEditor
      parentAmountMagnitude={100}
      parentAmountSign={-1}
      initial={[]}
      categories={cats}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { ...utils, onChange };
}

describe('SplitEditor', () => {
  it('shows the "Ventiler" trigger button when initial is empty', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: /Ventiler cette transaction/ })).toBeInTheDocument();
    expect(screen.queryByText(/Reste à ventiler/)).not.toBeInTheDocument();
  });

  it('clicking the trigger seeds two rows with a balanced remainder', async () => {
    const user = userEvent.setup();
    const { onChange } = renderEditor();
    await user.click(screen.getByRole('button', { name: /Ventiler cette transaction/ }));
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toHaveLength(2);
    // First row seeded with half the magnitude, second with the remainder.
    const cents = (m: string) => Math.round(Number(m) * 100);
    expect(cents(last[0].amountMagnitude) + cents(last[1].amountMagnitude)).toBe(100 * 100);
  });

  it('editing a magnitude rebalances the delta into the last row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderEditor({
      initial: [
        { id: 1, transactionId: 1, categoryId: 10, amount: '-40.00', memo: null },
        { id: 2, transactionId: 1, categoryId: 11, amount: '-60.00', memo: null },
      ],
    });
    const firstMagInput = screen.getAllByPlaceholderText(/\d+,\d\d/)[0]; // first "40.00" field
    await user.clear(firstMagInput);
    await user.type(firstMagInput, '55.00');
    const last = onChange.mock.calls.at(-1)![0];
    expect(last[0].amountMagnitude).toBe('55.00');
    // Second row snapped to 45.00 (parent 100 - 55).
    expect(last[1].amountMagnitude).toBe('45.00');
    // "Reste à ventiler" chip in sage tone (test the ARIA / class contains 'sage')
    const chip = screen.getByText(/Reste à ventiler/).closest('[data-testid="split-remainder"]')!;
    expect(chip.className).toMatch(/sage/);
  });

  it('mismatch shows a red "Reste à ventiler" chip', async () => {
    const user = userEvent.setup();
    renderEditor({
      initial: [
        { id: 1, transactionId: 1, categoryId: 10, amount: '-40.00', memo: null },
        { id: 2, transactionId: 1, categoryId: 11, amount: '-60.00', memo: null },
      ],
    });
    const [firstMag] = screen.getAllByPlaceholderText(/\d+,\d\d/);
    // Type over the first magnitude with an intentionally-unbalancing value…
    await user.clear(firstMag);
    await user.type(firstMag, '55.00');
    // …then delete the second row so the balance is off (100 - 55 = 45 not in the set).
    const removeButtons = screen.getAllByRole('button', { name: '✕' });
    await user.click(removeButtons[1]);
    const chip = screen.getByText(/Reste à ventiler/).closest('[data-testid="split-remainder"]')!;
    expect(chip.className).toMatch(/clay|red/);
  });

  it('renders disabled hint when disabled is true and hides the editor', () => {
    renderEditor({ disabled: true });
    expect(screen.getByText(/virement interne/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ventiler cette transaction/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failures because the component doesn't exist**

Run:
```bash
cd frontend && npm test -- --run SplitEditor
```

Expected: import failure.

- [ ] **Step 3: Implement `SplitEditor.tsx`**

Create `frontend/src/pages/Transactions/SplitEditor.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { Category, TransactionSplit } from '../../api/types';

export type DraftSplit = {
  key: string;
  categoryId: number | '';
  amountMagnitude: string;   // unsigned, decimal with dot or comma
  memo: string;
};

function toCents(mag: string): number {
  const cleaned = mag.replace(/€/g, '').replace(/\s+/g, '').replace(',', '.').trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned) * 100);
}

function centsToMag(cents: number): string {
  return (cents / 100).toFixed(2);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function fromInitial(initial: TransactionSplit[]): DraftSplit[] {
  return initial.map((s) => ({
    key: `s-${s.id}`,
    categoryId: s.categoryId ?? '',
    amountMagnitude: Math.abs(Number(s.amount)).toFixed(2),
    memo: s.memo ?? '',
  }));
}

export function SplitEditor({
  parentAmountMagnitude,
  parentAmountSign,
  disabled = false,
  initial,
  categories,
  onChange,
}: {
  parentAmountMagnitude: number;
  parentAmountSign: -1 | 1 | 0;
  disabled?: boolean;
  initial: TransactionSplit[];
  categories: Category[];
  onChange: (splits: DraftSplit[]) => void;
}) {
  const [rows, setRows] = useState<DraftSplit[]>(() => fromInitial(initial));

  // Rehydrate whenever the initial array identity changes (modal reopen).
  useEffect(() => {
    setRows(fromInitial(initial));
  }, [initial]);

  const parentCents = Math.round(parentAmountMagnitude * 100);
  const remainderCents = useMemo(() => {
    const sum = rows.reduce((acc, r) => {
      const c = toCents(r.amountMagnitude);
      return acc + (Number.isFinite(c) ? c : 0);
    }, 0);
    return parentCents - sum;
  }, [rows, parentCents]);

  function update(next: DraftSplit[]) {
    setRows(next);
    onChange(next);
  }

  function seedTwo() {
    const half = Math.floor(parentCents / 2);
    const rest = parentCents - half;
    update([
      { key: uid(), categoryId: '', amountMagnitude: centsToMag(half), memo: '' },
      { key: uid(), categoryId: '', amountMagnitude: centsToMag(rest), memo: '' },
    ]);
  }

  function rebalanceLast(next: DraftSplit[]) {
    if (next.length === 0) return next;
    const withoutLast = next.slice(0, -1);
    const sumWithoutLast = withoutLast.reduce((acc, r) => {
      const c = toCents(r.amountMagnitude);
      return acc + (Number.isFinite(c) ? c : 0);
    }, 0);
    const lastCents = parentCents - sumWithoutLast;
    return [
      ...withoutLast,
      { ...next[next.length - 1], amountMagnitude: centsToMag(Math.max(0, lastCents)) },
    ];
  }

  function editRow(idx: number, patch: Partial<DraftSplit>) {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    // If magnitude changed and there are 2+ rows, rebalance the last row.
    if (patch.amountMagnitude !== undefined && next.length >= 2 && idx !== next.length - 1) {
      update(rebalanceLast(next));
    } else {
      update(next);
    }
  }

  function addRow() {
    const next: DraftSplit[] = [
      ...rows,
      { key: uid(), categoryId: '', amountMagnitude: '0.00', memo: '' },
    ];
    update(rebalanceLast(next));
  }

  function removeRow(idx: number) {
    const dropped = rows[idx];
    const droppedCents = toCents(dropped.amountMagnitude);
    const remaining = rows.filter((_, i) => i !== idx);
    if (remaining.length === 0) {
      update([]);
      return;
    }
    // Move the dropped magnitude into the last remaining row so sum stays constant.
    const lastIdx = remaining.length - 1;
    const lastCents = toCents(remaining[lastIdx].amountMagnitude);
    remaining[lastIdx] = {
      ...remaining[lastIdx],
      amountMagnitude: centsToMag((Number.isFinite(lastCents) ? lastCents : 0) + (Number.isFinite(droppedCents) ? droppedCents : 0)),
    };
    update(remaining);
  }

  if (disabled) {
    return (
      <div className="mt-4 text-xs text-ink-500">
        La ventilation n'est pas disponible pour un virement interne.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <button type="button" className="btn-ghost text-sm" onClick={seedTwo} disabled={parentCents === 0}>
          + Ventiler cette transaction
        </button>
      </div>
    );
  }

  const remainderTone =
    remainderCents === 0
      ? 'border-sage-800/40 bg-sage-900/15 text-sage-200'
      : 'border-clay-800/60 bg-clay-900/30 text-clay-200';
  const signPrefix = parentAmountSign < 0 ? '-' : '';

  return (
    <div className="mt-4">
      <div className="label mb-2">Ventilation par catégorie</div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.key} className="flex items-center gap-2">
            <input
              className="input font-mono w-28"
              inputMode="decimal"
              value={r.amountMagnitude}
              onChange={(e) => editRow(i, { amountMagnitude: e.target.value })}
              placeholder="0,00"
            />
            <select
              className="input flex-1"
              value={r.categoryId}
              onChange={(e) => editRow(i, { categoryId: e.target.value ? Number(e.target.value) : '' })}
            >
              <option value="">— catégorie</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input
              className="input flex-1"
              placeholder="mémo (optionnel)"
              value={r.memo}
              onChange={(e) => editRow(i, { memo: e.target.value })}
            />
            <button
              type="button"
              className="btn-ghost !py-1 !px-2 text-ink-500 hover:text-clay-300"
              aria-label="Retirer cette ligne"
              onClick={() => removeRow(i)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div
        data-testid="split-remainder"
        className={`mt-2 rounded-lg border px-3 py-2 text-xs flex items-center justify-between gap-3 ${remainderTone}`}
      >
        <span>
          Reste à ventiler :{' '}
          <span className="font-mono">{signPrefix}{centsToMag(Math.abs(remainderCents))} €</span>
        </span>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost !py-1 !px-2 text-sm" onClick={addRow}>
            + Ajouter une ligne
          </button>
          <button type="button" className="btn-ghost !py-1 !px-2 text-sm" onClick={() => update([])}>
            Supprimer la ventilation
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect tests to pass**

Run:
```bash
cd frontend && npm test -- --run SplitEditor
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions/SplitEditor.tsx \
        frontend/src/pages/Transactions/__tests__/SplitEditor.test.tsx
git commit -m "feat(splits): SplitEditor component with rebalancing logic"
```

---

## Task 11 — Wire SplitEditor into TransactionModal

**Files:**
- Modify: `frontend/src/pages/Transactions/TransactionModal.tsx`
- Modify: `frontend/src/pages/Transactions/__tests__/TransactionModal.test.tsx` (new cases)

**Interfaces:**
- Consumes: `SplitEditor`, `DraftSplit` from Task 10.
- Produces: after a successful create/edit submit, the modal chains `PUT /api/transactions/:id/splits` (or DELETE) based on the local draft state. The Save button is disabled while the remainder chip is non-zero.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/pages/Transactions/__tests__/TransactionModal.test.tsx`, inside the top-level `describe('TransactionModal', ...)`:

```ts
it('chains PUT /splits after POST when splits are drafted in create mode', async () => {
  apiMock
    .mockResolvedValueOnce({ transaction: { id: 999 } })  // POST /api/transactions
    .mockResolvedValueOnce({ splits: [] });                // PUT /api/transactions/999/splits
  const user = userEvent.setup();
  renderModal();

  await user.selectOptions(fieldFor('Compte'), '1');
  await user.clear(screen.getByPlaceholderText('JJ/MM/AAAA'));
  await user.type(screen.getByPlaceholderText('JJ/MM/AAAA'), '15/06/2026');
  await user.type(screen.getByPlaceholderText('-25,30'), '-100.00');
  await user.type(screen.getByPlaceholderText('Carrefour Évry'), 'Amazon');

  // Ventilate: click the trigger, then set categories on the two seeded rows.
  await user.click(screen.getByRole('button', { name: /Ventiler cette transaction/ }));
  const [firstCategory, secondCategory] = screen.getAllByRole('combobox').slice(1); // first combobox is "Compte"
  await user.selectOptions(firstCategory, '10');
  await user.selectOptions(secondCategory, '10');

  await user.click(screen.getByRole('button', { name: 'Créer la transaction' }));

  await waitFor(() => {
    // First call POSTs the transaction.
    expect(apiMock).toHaveBeenNthCalledWith(1, '/api/transactions', expect.objectContaining({
      method: 'POST',
    }));
    // Second call PUTs the splits.
    expect(apiMock).toHaveBeenNthCalledWith(2, '/api/transactions/999/splits', expect.objectContaining({
      method: 'PUT',
      json: expect.objectContaining({
        splits: expect.arrayContaining([
          expect.objectContaining({ categoryId: 10, amount: expect.stringMatching(/^-?\d+\.\d{2}$/) }),
        ]),
      }),
    }));
  });
});

it('does not enable the submit button while remainder is non-zero', async () => {
  const user = userEvent.setup();
  renderModal();

  await user.selectOptions(fieldFor('Compte'), '1');
  await user.clear(screen.getByPlaceholderText('JJ/MM/AAAA'));
  await user.type(screen.getByPlaceholderText('JJ/MM/AAAA'), '15/06/2026');
  await user.type(screen.getByPlaceholderText('-25,30'), '-100.00');
  await user.type(screen.getByPlaceholderText('Carrefour Évry'), 'Amazon');
  await user.click(screen.getByRole('button', { name: /Ventiler cette transaction/ }));

  // Unbalance: type over the first magnitude.
  const firstMag = screen.getAllByPlaceholderText(/\d+,\d\d/)[0];
  await user.clear(firstMag);
  await user.type(firstMag, '999.00');
  const submit = screen.getByRole('button', { name: 'Créer la transaction' });
  expect(submit).toBeDisabled();
});
```

- [ ] **Step 2: Run — expect failures**

Run:
```bash
cd frontend && npm test -- --run TransactionModal
```

Expected: the two new tests fail because the modal doesn't render `SplitEditor` yet.

- [ ] **Step 3: Wire the editor into `TransactionModal.tsx`**

Edit `frontend/src/pages/Transactions/TransactionModal.tsx`. Add imports at the top:

```ts
import { SplitEditor, type DraftSplit } from './SplitEditor';
import type { Account, Category, Transaction, TransactionSplit } from '../../api/types';
```

Add state next to the other `useState` calls:

```ts
  const [splitsDraft, setSplitsDraft] = useState<DraftSplit[]>([]);
```

In the `useEffect(() => { if (!open) return; ... }, [open, transaction])` block, extend the seeding to load initial splits when in edit mode:

```ts
    if (transaction) {
      // ...existing seed lines...
      setSplitsDraft(transaction.splits.map((s) => ({
        key: `s-${s.id}`,
        categoryId: s.categoryId ?? '',
        amountMagnitude: Math.abs(Number(s.amount)).toFixed(2),
        memo: s.memo ?? '',
      })));
    } else {
      // ...existing seed lines...
      setSplitsDraft([]);
    }
```

Add derived values below the state block:

```ts
  const cleanedAmountForSplit = amount.replace(/€/g, '').replace(/\s+/g, '').replace(',', '.').trim();
  const parentCents = /^-?\d+(\.\d{1,2})?$/.test(cleanedAmountForSplit)
    ? Math.round(Number(cleanedAmountForSplit) * 100)
    : 0;
  const parentAmountMagnitude = Math.abs(parentCents) / 100;
  const parentAmountSign: -1 | 1 | 0 =
    parentCents === 0 ? 0 : parentCents < 0 ? -1 : 1;
  const isTransfer = transaction?.transferGroupId != null;

  const splitsSumCents = splitsDraft.reduce((acc, r) => {
    const cleaned = r.amountMagnitude.replace(',', '.');
    if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return acc;
    return acc + Math.round(Number(cleaned) * 100);
  }, 0);
  const remainderCents = Math.abs(parentCents) - splitsSumCents;
  const splitsInvalid = splitsDraft.length > 0 && (
    remainderCents !== 0 ||
    splitsDraft.some((r) => r.categoryId === '' || Math.round(Number(r.amountMagnitude.replace(',', '.')) * 100) === 0)
  );
```

Insert the `<SplitEditor>` after the notes/lock-years section, before the submit-button row:

```tsx
        <SplitEditor
          parentAmountMagnitude={parentAmountMagnitude}
          parentAmountSign={parentAmountSign}
          disabled={isTransfer}
          initial={transaction?.splits ?? []}
          categories={categories}
          onChange={setSplitsDraft}
        />
```

Disable submit when `splitsInvalid`:

```tsx
          <button type="submit" className="btn-primary" disabled={pending || splitsInvalid}>
            {pending
              ? isEdit ? 'Enregistrement…' : 'Création…'
              : isEdit ? 'Enregistrer' : 'Créer la transaction'}
          </button>
```

Chain the splits PUT/DELETE after the transaction mutation. Rewrite the two mutations to use the raw `api` call directly inside a shared helper (simpler than mutating `useMutation`'s onSuccess). Replace the two `useMutation` blocks and the `submit` function with:

```ts
  async function persistSplits(txId: number): Promise<void> {
    const sign = parentCents < 0 ? -1 : 1;
    if (splitsDraft.length === 0) {
      // Only DELETE when we're editing a previously-split transaction.
      if (transaction && transaction.splits.length > 0) {
        await api(`/api/transactions/${txId}/splits`, { method: 'DELETE' });
      }
      return;
    }
    await api(`/api/transactions/${txId}/splits`, {
      method: 'PUT',
      json: {
        splits: splitsDraft.map((r) => ({
          categoryId: r.categoryId === '' ? 0 : r.categoryId,  // server will 400 on 0 — should not happen because splitsInvalid guards
          amount: (Math.round(Number(r.amountMagnitude.replace(',', '.')) * 100) * sign / 100).toFixed(2),
          memo: r.memo.trim() ? r.memo : null,
        })),
      },
    });
  }

  const create = useMutation({
    mutationFn: async (input: {
      accountId: number;
      date: string;
      amount: string;
      rawLabel: string;
      categoryId: number | null;
      notes: string | null;
      lockYears: number | null;
    }) => {
      const { transaction: tx } = await api<{ transaction: Transaction }>('/api/transactions', {
        method: 'POST', json: input,
      });
      await persistSplits(tx.id);
      return { transaction: tx };
    },
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err: ApiError) => setError(err.message),
  });

  const update = useMutation({
    mutationFn: async (input: {
      id: number;
      patch: Partial<{
        accountId: number;
        date: string;
        amount: string;
        rawLabel: string;
        categoryId: number | null;
        notes: string | null;
        lockYears: number | null;
      }>;
    }) => {
      const res = await api<{ transaction: Transaction }>(`/api/transactions/${input.id}`, {
        method: 'PATCH', json: input.patch,
      });
      await persistSplits(input.id);
      return res;
    },
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err: ApiError) => setError(err.message),
  });
```

Leave the `submit` function body largely unchanged — it already calls `create.mutate` / `update.mutate` with the right payloads. The `splitsInvalid` gate at the button level prevents the code from being reached with an invalid draft.

- [ ] **Step 4: Run — expect the two new tests to pass, and existing tests to still pass**

Run:
```bash
cd frontend && npm test -- --run TransactionModal
```

Expected: green. If the older tests fail because they now trigger an unintended second `api` call, tighten the fixture: on create mode with an unchanged empty draft, `persistSplits` should be a no-op (see the guard `splitsDraft.length === 0 && transaction === null`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions/TransactionModal.tsx \
        frontend/src/pages/Transactions/__tests__/TransactionModal.test.tsx
git commit -m "feat(splits): wire SplitEditor into TransactionModal + chain PUT/DELETE"
```

---

## Task 12 — TransactionRow badge + expandable sub-rows

**Files:**
- Modify: `frontend/src/pages/Transactions/TransactionRow.tsx`
- Modify: `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`

**Interfaces:**
- Consumes new props on `TransactionRow`:
  ```ts
  expanded: boolean;
  onToggleExpanded: (id: number) => void;
  ```
- Produces: when `tx.splits.length > 0`, the category cell renders `[▸ Ventilée (N)]` in place of the `<select>`. Clicking calls `onToggleExpanded(tx.id)`. When `expanded` is true, the row emits a sibling `<tr>` per split beneath it, with two visible cells: category name + amount.

- [ ] **Step 1: Write the failing tests**

Edit `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`. Add:

```tsx
const splitTx: Transaction = {
  id: 42,
  accountId: 1,
  date: '2026-07-04',
  amount: '-100.00',
  rawLabel: 'Amazon FR',
  normalizedLabel: 'amazon',
  memo: null,
  notes: null,
  fitid: null,
  dedupKey: 'dk-42',
  categoryId: null,
  categorySource: 'manual',
  transferGroupId: null,
  sourceFileId: null,
  importedAt: '2026-07-04T00:00:00Z',
  splits: [
    { id: 1, transactionId: 42, categoryId: 10, amount: '-60.00', memo: 'Kindle' },
    { id: 2, transactionId: 42, categoryId: 11, amount: '-40.00', memo: null },
  ],
};

it('renders a "Ventilée (N)" badge in place of the category select when split', () => {
  const { container } = renderRow({ tx: splitTx, expanded: false });
  expect(screen.getByRole('button', { name: /Ventilée \(2\)/ })).toBeInTheDocument();
  expect(container.querySelector('select')).not.toBeInTheDocument();
});

it('emits sub-rows when expanded is true', () => {
  renderRow({ tx: splitTx, expanded: true });
  expect(screen.getByText(/Livres/)).toBeInTheDocument();
  expect(screen.getByText(/Électro/)).toBeInTheDocument();
});

it('clicking the badge calls onToggleExpanded with the tx id', async () => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  renderRow({ tx: splitTx, expanded: false, onToggleExpanded: onToggle });
  await user.click(screen.getByRole('button', { name: /Ventilée \(2\)/ }));
  expect(onToggle).toHaveBeenCalledWith(splitTx.id);
});
```

Adjust the existing `renderRow` helper in that file so it accepts `expanded` and `onToggleExpanded` with defaults (`false` and `() => {}`). Add `splits: []` to every existing fixture literal.

- [ ] **Step 2: Run — expect the new tests to fail**

Run:
```bash
cd frontend && npm test -- --run TransactionRow
```

Expected: import fails or fixtures error out until you finish Step 1's helper adjustments; then the new tests fail because the row doesn't render the badge.

- [ ] **Step 3: Extend `TransactionRow.tsx`**

Edit the component. Change the signature to accept the two new props:

```tsx
export function TransactionRow({
  tx,
  account,
  categories,
  selected,
  onToggleSelect,
  onUpdateCategory,
  onUpdateNotes,
  onEdit,
  onDelete,
  expanded,
  onToggleExpanded,
}: {
  tx: Transaction;
  account: Account | undefined;
  categories: Category[];
  selected: boolean;
  onToggleSelect: (id: number, checked: boolean) => void;
  onUpdateCategory: (id: number, patch: { categoryId: number | null }) => void;
  onUpdateNotes: (id: number, patch: { notes: string | null }) => void;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  expanded: boolean;
  onToggleExpanded: (id: number) => void;
}) {
```

Replace the current `<td>` for the category column (the `<select>` block) with a conditional:

```tsx
      <td className="px-4 py-2.5">
        {tx.splits.length > 0 ? (
          <button
            type="button"
            className="btn-ghost !py-1 !px-2 text-xs text-sage-200"
            onClick={() => onToggleExpanded(tx.id)}
            aria-expanded={expanded}
          >
            {expanded ? '▾' : '▸'} Ventilée ({tx.splits.length})
          </button>
        ) : (
          <>
            <select
              className="input-sm"
              value={tx.categoryId ?? ''}
              disabled={!!tx.transferGroupId}
              onChange={(e) =>
                onUpdateCategory(tx.id, {
                  categoryId: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {tx.categorySource === 'manual' && <div className="text-[10px] text-ink-500 mt-1">manuel</div>}
          </>
        )}
      </td>
```

Wrap the whole return in a Fragment and, after the main `<tr>...</tr>`, render sub-rows when `expanded && tx.splits.length > 0`:

```tsx
export function TransactionRow(props: /* ... */) {
  const { tx, account, categories, expanded } = props;
  const catById = new Map(categories.map((c) => [c.id, c]));
  return (
    <>
      <tr>
        {/* ...existing row markup with the conditional category cell... */}
      </tr>
      {expanded && tx.splits.length > 0 && tx.splits.map((s) => {
        const cat = s.categoryId ? catById.get(s.categoryId) : null;
        return (
          <tr key={`split-${s.id}`} className="border-b border-ink-900/30 bg-ink-900/20">
            <td />
            <td />
            <td className="hidden sm:table-cell" />
            <td className="px-4 py-1.5 pl-8 text-ink-300 text-xs">
              ⤷ {cat?.name ?? '—'}
              {s.memo && <span className="text-ink-500 ml-2">· {s.memo}</span>}
            </td>
            <td />
            <td className="hidden md:table-cell" />
            <td className={`px-4 py-1.5 text-right font-mono text-xs tabular-nums`}>
              {s.amount} {account?.currency ?? 'EUR'}
            </td>
            <td />
          </tr>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Run — expect all TransactionRow tests to pass**

Run:
```bash
cd frontend && npm test -- --run TransactionRow
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions/TransactionRow.tsx \
        frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx
git commit -m "feat(splits): row badge + expandable sub-rows for ventilated tx"
```

---

## Task 13 — Own expanded-ids Set at the Transactions page level

**Files:**
- Modify: `frontend/src/pages/Transactions/index.tsx`
- Modify: `frontend/src/pages/Transactions/TransactionsTable.tsx`

**Interfaces:**
- `TransactionsTable` accepts `expandedIds: Set<number>` and `onToggleExpanded: (id: number) => void`, threads them to each `TransactionRow`.

- [ ] **Step 1: Extend `TransactionsTable.tsx`**

Add the two new props to the component signature and pass them through:

```tsx
export function TransactionsTable({
  transactions,
  categories,
  accountById,
  isLoading,
  filters,
  setFilters,
  setOffset,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onUpdateCategory,
  onUpdateNotes,
  onEdit,
  onDelete,
  expandedIds,
  onToggleExpanded,
}: {
  // ...existing props...
  expandedIds: Set<number>;
  onToggleExpanded: (id: number) => void;
}) {
```

In the map, add the two props:

```tsx
              transactions.map((t) => (
                <TransactionRow
                  key={t.id}
                  tx={t}
                  account={accountById.get(t.accountId)}
                  categories={categories}
                  selected={selectedIds.has(t.id)}
                  expanded={expandedIds.has(t.id)}
                  onToggleExpanded={onToggleExpanded}
                  onToggleSelect={onToggleSelect}
                  onUpdateCategory={onUpdateCategory}
                  onUpdateNotes={onUpdateNotes}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))
```

- [ ] **Step 2: Extend `Transactions/index.tsx`**

Own the state and pass it down:

```tsx
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
```

Reset alongside `selectedIds` when filters or offset change:

```tsx
  useEffect(() => {
    setSelectedIds(new Set());
    setExpandedIds(new Set());
  }, [filters, offset]);
```

Pass to the table:

```tsx
        expandedIds={expandedIds}
        onToggleExpanded={(id) => {
          setExpandedIds((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }}
```

- [ ] **Step 3: Run the frontend suite end-to-end**

Run:
```bash
cd frontend && npm test -- --run
```

Expected: green. Then manually smoke-test in the dev server:

```bash
cd frontend && npm run dev
```

Open Transactions, click a split-row's badge, verify sub-rows expand/collapse.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Transactions/index.tsx \
        frontend/src/pages/Transactions/TransactionsTable.tsx
git commit -m "feat(splits): thread expanded-ids Set from Transactions page"
```

---

## Task 14 — TODO.md housekeeping

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Move the item**

Edit `TODO.md`. Remove the "Splitter une transaction en plusieurs catégories …" bullet from the ideas section, drop the same bullet from the "Pour plus tard" section, and add under "✅ Fait":

```md
- **Transaction splits (ventilation)** : nouvelle table
  `transaction_splits` avec somme forcée = parent.amount via trigger
  deferrable côté DB. Éditeur intégré à `TransactionModal`, badge
  `Ventilée (N)` + sous-lignes développables sur la liste. Migration
  `0014`. Backup v2 emporte les splits. Non fait : rules qui produisent
  des splits automatiquement (spec séparée).
```

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "docs(todo): move transaction splits to Fait"
```

---

## Self-review checklist

- **Spec coverage** — every spec section maps to a task:
  - Storage → Task 1
  - Semantics & aggregates → Tasks 6, 7 (aggregates) + Tasks 3, 5 (list hydration + filter) + Task 4 (amount-lock)
  - API (splits routes + PATCH 409) → Tasks 2, 3, 4, 5
  - Frontend types → Task 9
  - Frontend TransactionModal editor → Tasks 10, 11
  - Frontend TransactionRow expansion → Tasks 12, 13
  - Backup v2 → Task 8
  - Tests — every task ends with `RUN_DB_TESTS=1 npm test` or `npm test --run` covering the new behavior.
  - Non-goals — respected: no rule-driven splits, no partial splits, PUT-only mutation.

- **No placeholders** — every step shows the exact SQL, TS, or shell command needed.

- **Type consistency** — `TransactionSplit { id, transactionId, categoryId: number | null, amount: string, memo: string | null }` is used identically in `frontend/src/api/types.ts` (Task 9), the backend serializer (Task 2 `serialize`), and the backup schema (Task 8 — modulo the natural-key `category` string). `DraftSplit` from Task 10 is the single source used by Task 11.
