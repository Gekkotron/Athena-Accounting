# Merge two accounts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-shot `POST /api/accounts/:sourceId/merge` endpoint plus a minimal Accounts-page UI that consolidates a duplicate source account into a target account, moving every transaction, repointing all side tables, summing opening balances, and deleting the source — all in one DB transaction.

**Architecture:** One new backend route appended to `backend/src/http/routes/accounts.ts`, driven by a Drizzle transaction that runs Steps A–G in order (lock-preserve → dedup-drop → transactions-move → transfer-collapse → side-tables-repoint → opening-balance-bump → source-delete). One new frontend component `MergeModal.tsx` invoked from a "•••" menu added to `AccountCard.tsx`, backed by a new API function in `frontend/src/api/accounts.ts`.

**Tech Stack:** Node 20+, Fastify 5, Drizzle ORM 0.36, `pg`, Zod 3, React 18, TanStack Query, Tailwind, Vitest.

## Global Constraints

- **Auth:** every DB access filters on `user_id = uid`. Both source and target must belong to the caller.
- **Currency lock:** `source.currency === target.currency` — mismatch → 400.
- **Idempotence:** re-invocation after success returns 404 (source is gone). No no-op path.
- **Public-safe logging:** only `{sourceId, targetId, uid, counts}` in log lines. Never account names or transaction details.
- **Atomicity:** the entire pipeline runs inside one `db.transaction()`. Any exception rolls back everything.
- **Commit style:** `feat(accounts): …` / `test(accounts): …` / `feat(frontend): …`. Commits as `Gekkotron <60887050+Gekkotron@users.noreply.github.com>` via `-c user.name=Gekkotron -c user.email=…` on every `git commit`. Do NOT modify `.git/config`. Do NOT push (main-only, push when asked).
- **Test gate:** DB-touching backend tests run under `RUN_DB_TESTS=1` and use `buildApp()` from `backend/tests/helpers/build-app.ts`, wrapped in `describe.skipIf(!RUN)`. Each test creates its own user via `POST /api/onboarding/create` to survive cross-file races (`tests/mcp/store.test.ts` wipes users in its `beforeAll`).
- **No schema migration.** Everything runs against the existing tables.

## File Structure

**Created:**
- `backend/tests/accounts-merge.test.ts` — DB-gated integration tests for the merge route (~250 LoC after all tasks).
- `frontend/src/api/accounts.ts` — thin `mergeAccount(sourceId, targetId)` fetcher + `MergeResult` interface (~30 LoC).
- `frontend/src/pages/Accounts/MergeModal.tsx` — target picker + confirmation modal (~130 LoC).
- `frontend/src/pages/Accounts/__tests__/MergeModal.test.tsx` — 4 unit cases (~90 LoC).

**Modified:**
- `backend/src/http/routes/accounts.ts` — append the merge route (~120 LoC of route code).
- `frontend/src/pages/Accounts/AccountCard.tsx` — add "•••" menu button + wire an `onMerge?: (a: Account) => void` callback.
- `frontend/src/pages/Accounts/index.tsx` — mount `MergeModal`, pass `onMerge` prop to each `AccountCard`.

---

### Task 1: Backend route scaffolding + validation

**Files:**
- Modify: `backend/src/http/routes/accounts.ts` (append the merge route after the existing `DELETE /api/accounts/:id` handler)
- Create: `backend/tests/accounts-merge.test.ts` (first five 4xx/404 cases)

**Interfaces:**
- Produces:
  - `POST /api/accounts/:sourceId/merge` with body `{ targetId: number }`. In this task it only validates and returns 200 `{ ok: true, merged: null }` on success — the pipeline itself lands in Task 2.

- [ ] **Step 1: Write the failing tests (validation & auth)**

Create `backend/tests/accounts-merge.test.ts`:

```ts
// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;

async function setupUser(username: string, password: string): Promise<string> {
  await app.inject({
    method: 'POST', url: '/api/onboarding/create',
    payload: { username, password },
  });
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { username, password },
  });
  return login.cookies[0]!.name + '=' + login.cookies[0]!.value;
}

async function createAccount(
  cookie: string, name: string, currency: string, opening = '0',
): Promise<number> {
  const res = await app.inject({
    method: 'POST', url: '/api/accounts',
    headers: { cookie },
    payload: {
      name, type: 'checking', currency,
      openingBalance: opening, openingDate: '2025-01-01',
    },
  });
  return res.json().account.id;
}

describe.skipIf(!RUN)('POST /api/accounts/:sourceId/merge — validation', () => {
  let cookie: string;
  let srcEur: number;
  let tgtEur: number;
  let usd: number;

  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    cookie = await setupUser('merge-val-user', 'merge-val-1234');
    srcEur = await createAccount(cookie, 'MergeValSrcEUR', 'EUR');
    tgtEur = await createAccount(cookie, 'MergeValTgtEUR', 'EUR');
    usd = await createAccount(cookie, 'MergeValUSD', 'USD');
  });

  afterAll(async () => { await app.close(); });

  it('404 on unknown source', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/accounts/999999/merge',
      headers: { cookie }, payload: { targetId: tgtEur },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/source not found/);
  });

  it('404 on unknown target', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${srcEur}/merge`,
      headers: { cookie }, payload: { targetId: 999999 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/target not found/);
  });

  it('400 when source and target are the same', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${srcEur}/merge`,
      headers: { cookie }, payload: { targetId: srcEur },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/must differ/);
  });

  it('400 on currency mismatch (EUR → USD)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${srcEur}/merge`,
      headers: { cookie }, payload: { targetId: usd },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/currency mismatch/);
    expect(res.json().sourceCurrency).toBe('EUR');
    expect(res.json().targetCurrency).toBe('USD');
  });

  it('404 when trying to merge another user’s account (non-enumeration)', async () => {
    const other = await setupUser('merge-val-other', 'merge-val-1234');
    const foreignSrc = await createAccount(other, 'ForeignSrc', 'EUR');
    // caller is `cookie`; foreignSrc belongs to `other`.
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${foreignSrc}/merge`,
      headers: { cookie }, payload: { targetId: tgtEur },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/source not found/);
  });

  it('200 on valid same-currency merge (pipeline is a no-op until Task 2)', async () => {
    const scratch = await createAccount(cookie, 'MergeValScratch', 'EUR');
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${scratch}/merge`,
      headers: { cookie }, payload: { targetId: tgtEur },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    // In Task 2 we assert on `merged` counts; for now the placeholder is null.
    expect(res.json().merged).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they all fail**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npx vitest run accounts-merge
```

Expected: all six FAIL — the route doesn't exist yet, every request 404s the ROUTE (not the resource).

- [ ] **Step 3: Add the merge route to `accounts.ts`**

Edit `backend/src/http/routes/accounts.ts`. Append after the existing `DELETE /api/accounts/:id` handler (before the closing `}` of `accountsRoutes`). Also add the zod body schema near the top of the file, alongside the existing `CreateBody` / `UpdateBody`:

Add near the schemas at the top:

```ts
const MergeBody = z.object({
  targetId: z.number().int().positive(),
});
```

Append inside `accountsRoutes`:

```ts
  app.post('/api/accounts/:sourceId/merge', async (req, reply) => {
    const uid = userId(req);

    // Parse and validate the source id from the URL param.
    const sourceParse = z.object({ sourceId: z.coerce.number().int().positive() })
      .safeParse(req.params);
    if (!sourceParse.success) {
      return reply.code(400).send({ error: 'invalid source id' });
    }
    const sourceId = sourceParse.data.sourceId;

    const bodyParse = MergeBody.safeParse(req.body);
    if (!bodyParse.success) {
      return reply.code(400).send({ error: 'invalid input', issues: bodyParse.error.issues });
    }
    const targetId = bodyParse.data.targetId;

    if (sourceId === targetId) {
      return reply.code(400).send({ error: 'source and target must differ' });
    }

    // Fetch both accounts in one query; each must belong to the caller.
    const rows = await db
      .select()
      .from(accounts)
      .where(and(inArray(accounts.id, [sourceId, targetId]), eq(accounts.userId, uid)));
    const source = rows.find((r) => r.id === sourceId);
    const target = rows.find((r) => r.id === targetId);
    if (!source) return reply.code(404).send({ error: 'source not found' });
    if (!target) return reply.code(404).send({ error: 'target not found' });

    if (source.currency !== target.currency) {
      return reply.code(400).send({
        error: 'currency mismatch',
        sourceCurrency: source.currency,
        targetCurrency: target.currency,
      });
    }

    // Pipeline lands in Task 2. For now, validate-only.
    app.log.info({ sourceId, targetId, uid }, 'account merge (validation-only)');
    return { ok: true, merged: null };
  });
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npx vitest run accounts-merge
```

Expected: six cases PASS.

- [ ] **Step 5: Type-check + full backend suite**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
npm run build && RUN_DB_TESTS=1 npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/src/http/routes/accounts.ts backend/tests/accounts-merge.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(accounts): merge route scaffolding + validation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Transactions pipeline (Steps A–C)

**Files:**
- Modify: `backend/src/http/routes/accounts.ts` (replace the validation-only body with a `db.transaction()` running Steps A, B, C)
- Modify: `backend/tests/accounts-merge.test.ts` (add happy path, dedup, lock-preservation cases in a second `describe` block)

**Interfaces:**
- Consumes: the route from Task 1 (auth, param/body parsing, ownership, currency gate).
- Produces:
  - Response `merged` shape (partial — the transfer, side-table, opening-balance, delete fields land in Tasks 3–4). This task guarantees:
    - `merged.transactionsMoved: number`
    - `merged.dedupCollisionsDropped: number`
    - Later tasks add fields to this same object.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/accounts-merge.test.ts`:

```ts
describe.skipIf(!RUN)('POST /api/accounts/:sourceId/merge — transactions pipeline', () => {
  let cookie: string;

  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    cookie = await setupUser('merge-tx-user', 'merge-tx-1234');
  });

  afterAll(async () => { await app.close(); });

  async function postTx(
    accountId: number, date: string, amount: string,
    rawLabel: string, extra: Record<string, unknown> = {},
  ): Promise<number> {
    const res = await app.inject({
      method: 'POST', url: '/api/transactions',
      headers: { cookie },
      payload: { accountId, date, amount, rawLabel, ...extra },
    });
    if (res.statusCode !== 201) {
      throw new Error(`create tx failed ${res.statusCode}: ${res.body}`);
    }
    return res.json().transaction.id;
  }

  it('moves all transactions from source to target (happy path)', async () => {
    const src = await createAccount(cookie, 'TxSrc', 'EUR', '100');
    const tgt = await createAccount(cookie, 'TxTgt', 'EUR', '50');
    await postTx(src, '2026-06-01', '-10.00', 'a');
    await postTx(src, '2026-06-02', '-20.00', 'b');
    await postTx(src, '2026-06-03', '-30.00', 'c');
    await postTx(tgt, '2026-05-01', '5.00', 'x');
    await postTx(tgt, '2026-05-02', '6.00', 'y');

    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().merged.transactionsMoved).toBe(3);
    expect(res.json().merged.dedupCollisionsDropped).toBe(0);

    const { db } = await import('../src/db/client.js');
    const { transactions } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const targetTxs = await db.select().from(transactions).where(eq(transactions.accountId, tgt));
    expect(targetTxs.length).toBe(5);
  });

  it('drops source transactions that collide by dedup_key with the target', async () => {
    const src = await createAccount(cookie, 'DedupSrc', 'EUR');
    const tgt = await createAccount(cookie, 'DedupTgt', 'EUR');
    // Two txs with identical (date, amount, rawLabel) triples get the same
    // dedup_key on each account. So creating the same triple on both accounts
    // sets up a collision.
    await postTx(src, '2026-06-10', '-42.00', 'dupe');
    await postTx(tgt, '2026-06-10', '-42.00', 'dupe');
    // A source-only row that should still move over.
    await postTx(src, '2026-06-11', '-7.00', 'unique');

    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().merged.dedupCollisionsDropped).toBe(1);
    expect(res.json().merged.transactionsMoved).toBe(1);

    const { db } = await import('../src/db/client.js');
    const { transactions } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const targetTxs = await db.select().from(transactions).where(eq(transactions.accountId, tgt));
    expect(targetTxs.length).toBe(2);
  });

  it('preserves source lock_years by promoting it to per-row before the move', async () => {
    const { db } = await import('../src/db/client.js');
    const { accounts, transactions } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');

    const src = await createAccount(cookie, 'LockSrc', 'EUR');
    const tgt = await createAccount(cookie, 'LockTgt', 'EUR');
    // Set source.lock_years = 5 directly (API accepts it too, but we skip
    // that indirection here).
    await db.update(accounts).set({ lockYears: 5 }).where(eq(accounts.id, src));
    // Insert a transaction with lock_years = NULL — this is what needs
    // promotion.
    await postTx(src, '2026-07-01', '-1.00', 'nolock');

    await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });

    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, tgt));
    expect(tx?.lockYears).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npx vitest run accounts-merge
```

Expected: happy-path FAILs because `merged.transactionsMoved` is undefined (still validation-only); dedup FAILs similarly; lock-preservation FAILs because we haven't implemented Step A yet.

- [ ] **Step 3: Implement Steps A, B, C in the route body**

Edit `backend/src/http/routes/accounts.ts`. Replace the placeholder tail (`app.log.info(…) ; return { ok: true, merged: null };`) with the transactional pipeline. Add `isNotNull` etc. to the imports at the top if missing.

Add to the top of the file if missing:

```ts
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
```

Replace the placeholder tail with:

```ts
    // ---- Pipeline (Steps A–C in this task; D–G land later) ------------
    const merged = await db.transaction(async (tx) => {
      // Step A — promote source's account-level lock_years to per-row
      // for transactions where the per-row value is null. Preserves lock
      // intent across the move.
      if (source.lockYears != null) {
        await tx.execute(sql`
          UPDATE transactions
             SET lock_years = ${source.lockYears}
           WHERE account_id = ${sourceId}
             AND lock_years IS NULL
        `);
      }

      // Step B — delete source transactions that collide by dedup_key
      // with an existing target transaction. Target's copy wins.
      const dedupDropped = await tx.execute<{ id: number }>(sql`
        DELETE FROM transactions
         WHERE account_id = ${sourceId}
           AND dedup_key IN (
             SELECT dedup_key FROM transactions WHERE account_id = ${targetId}
           )
        RETURNING id
      `);
      const dedupCollisionsDropped = dedupDropped.rows.length;

      // Step C — move every remaining source transaction onto target.
      const moved = await tx.execute<{ id: number }>(sql`
        UPDATE transactions
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const transactionsMoved = moved.rows.length;

      return {
        transactionsMoved,
        dedupCollisionsDropped,
      };
    });

    app.log.info(
      { sourceId, targetId, uid, counts: merged },
      'account merge (steps A-C)',
    );
    return { ok: true, merged };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npx vitest run accounts-merge
```

Expected: all Task-1 cases still PASS + three new cases PASS.

- [ ] **Step 5: Type-check + full suite**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
npm run build && RUN_DB_TESTS=1 npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/src/http/routes/accounts.ts backend/tests/accounts-merge.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(accounts): merge pipeline steps A-C (lock, dedup, move transactions)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Transfer collapse + side tables + finalize (Steps D–G)

**Files:**
- Modify: `backend/src/http/routes/accounts.ts` (extend the pipeline with Steps D–G)
- Modify: `backend/tests/accounts-merge.test.ts` (add transfer-collapse, side-tables, opening-balance, source-deleted cases in a third `describe`)

**Interfaces:**
- Consumes: `merged.transactionsMoved` + `merged.dedupCollisionsDropped` from Task 2.
- Produces: extends `merged` with:
  - `transferGroupsCollapsed: number`
  - `patternsMoved: number`
  - `checkpointsMoved: number`
  - `budgetsMoved: number`
  - `importsMoved: number`
  - `templatesMoved: number`
  - `draftsMoved: number`
  - `openingBalanceAdded: string` (14.2 decimal string, taken verbatim from `source.opening_balance`)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/accounts-merge.test.ts`:

```ts
describe.skipIf(!RUN)('POST /api/accounts/:sourceId/merge — side tables + finalize', () => {
  let cookie: string;

  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    cookie = await setupUser('merge-side-user', 'merge-side-1234');
  });

  afterAll(async () => { await app.close(); });

  async function postTx(
    accountId: number, date: string, amount: string,
    rawLabel: string, extra: Record<string, unknown> = {},
  ): Promise<number> {
    const res = await app.inject({
      method: 'POST', url: '/api/transactions',
      headers: { cookie },
      payload: { accountId, date, amount, rawLabel, ...extra },
    });
    if (res.statusCode !== 201) {
      throw new Error(`create tx failed ${res.statusCode}: ${res.body}`);
    }
    return res.json().transaction.id;
  }

  it('collapses transfer groups whose legs are now all on target', async () => {
    const { db } = await import('../src/db/client.js');
    const { transactions } = await import('../src/db/schema.js');
    const { eq, inArray } = await import('drizzle-orm');

    const src = await createAccount(cookie, 'XferSrc', 'EUR');
    const tgt = await createAccount(cookie, 'XferTgt', 'EUR');
    const legA = await postTx(src, '2026-06-01', '-100.00', 'xferA');
    const legB = await postTx(tgt, '2026-06-01', '100.00', 'xferB');
    // Force a transfer_group_id linking both legs.
    const groupId = '11111111-1111-1111-1111-111111111111';
    await db.update(transactions)
      .set({ transferGroupId: groupId })
      .where(inArray(transactions.id, [legA, legB]));

    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().merged.transferGroupsCollapsed).toBe(1);

    const rows = await db.select().from(transactions).where(eq(transactions.accountId, tgt));
    expect(rows.every((r) => r.transferGroupId === null)).toBe(true);
  });

  it('repoints filename patterns, checkpoints, budgets, imports, templates', async () => {
    const { db } = await import('../src/db/client.js');
    const {
      accountFilenamePatterns, balanceCheckpoints, categoryBudgets, categories,
      fileImports, pdfStatementTemplates,
    } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');

    const src = await createAccount(cookie, 'SideSrc', 'EUR');
    const tgt = await createAccount(cookie, 'SideTgt', 'EUR');

    // Get user id for scoped inserts.
    const { users } = await import('../src/db/schema.js');
    const [u] = await db.select().from(users).where(eq(users.username, 'merge-side-user'));
    const uid = u!.id;

    // 1 filename pattern
    await db.insert(accountFilenamePatterns).values({
      userId: uid, pattern: 'side-*.ofx', accountId: src, priority: 0,
    });
    // 1 balance checkpoint
    await db.insert(balanceCheckpoints).values({
      userId: uid, accountId: src, checkpointDate: '2026-04-01', expectedAmount: '10.00',
    });
    // 1 category + 1 budget on that category, scoped to src
    const [cat] = await db.insert(categories).values({
      userId: uid, name: 'SideBudgetCat', kind: 'expense',
    }).returning();
    await db.insert(categoryBudgets).values({
      userId: uid, categoryId: cat.id, monthlyLimit: '100.00',
      currency: 'EUR', period: 'monthly', accountId: src,
    });
    // 1 file_import row
    await db.insert(fileImports).values({
      userId: uid, filename: 'side.ofx', accountId: src, format: 'ofx',
      totalLines: 0, insertedCount: 0, dedupSkipped: 0,
    });
    // 1 pdf template
    await db.insert(pdfStatementTemplates).values({
      userId: uid, accountId: src, fingerprint: 'side-fp', label: 'side',
      zones: {}, source: 'user',
    });

    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().merged.patternsMoved).toBe(1);
    expect(res.json().merged.checkpointsMoved).toBe(1);
    expect(res.json().merged.budgetsMoved).toBe(1);
    expect(res.json().merged.importsMoved).toBe(1);
    expect(res.json().merged.templatesMoved).toBe(1);

    // Each row now points to the target.
    const pats = await db.select().from(accountFilenamePatterns).where(eq(accountFilenamePatterns.accountId, tgt));
    expect(pats.length).toBe(1);
    const cps = await db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.accountId, tgt));
    expect(cps.length).toBe(1);
    const buds = await db.select().from(categoryBudgets).where(eq(categoryBudgets.accountId, tgt));
    expect(buds.length).toBe(1);
    const imps = await db.select().from(fileImports).where(eq(fileImports.accountId, tgt));
    expect(imps.length).toBe(1);
    const tpls = await db.select().from(pdfStatementTemplates).where(eq(pdfStatementTemplates.accountId, tgt));
    expect(tpls.length).toBe(1);
  });

  it('sums opening_balance onto target and deletes the source', async () => {
    const src = await createAccount(cookie, 'OpBalSrc', 'EUR', '100.00');
    const tgt = await createAccount(cookie, 'OpBalTgt', 'EUR', '50.00');

    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${src}/merge`,
      headers: { cookie }, payload: { targetId: tgt },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().merged.openingBalanceAdded).toBe('100.00');

    const tgtRes = await app.inject({
      method: 'GET', url: `/api/accounts/${tgt}`,
      headers: { cookie },
    });
    // opening_balance stored as numeric(14,2); Drizzle serializes as string.
    expect(tgtRes.json().account.openingBalance).toBe('150.00');

    const srcRes = await app.inject({
      method: 'GET', url: `/api/accounts/${src}`,
      headers: { cookie },
    });
    expect(srcRes.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npx vitest run accounts-merge
```

Expected: the three new cases FAIL. The transfer-collapse case fails on `transferGroupsCollapsed` being undefined; the side-tables case fails on the moved counts being undefined; the opening-balance case fails because the source is still present after the merge.

- [ ] **Step 3: Extend the pipeline with Steps D–G**

Edit `backend/src/http/routes/accounts.ts`. Add these table imports at the top (add whatever is missing):

```ts
import {
  accounts, accountFilenamePatterns, balanceCheckpoints, categoryBudgets,
  fileImports, pdfImportDrafts, pdfStatementTemplates, transactions,
} from '../../db/schema.js';
```

Replace the whole `db.transaction()` block inside the merge route with:

```ts
    const merged = await db.transaction(async (tx) => {
      // ---- Step A — promote source's account-level lock_years to per-row.
      if (source.lockYears != null) {
        await tx.execute(sql`
          UPDATE transactions
             SET lock_years = ${source.lockYears}
           WHERE account_id = ${sourceId}
             AND lock_years IS NULL
        `);
      }

      // ---- Step B — drop dedup collisions from source.
      const dedupDropped = await tx.execute<{ id: number }>(sql`
        DELETE FROM transactions
         WHERE account_id = ${sourceId}
           AND dedup_key IN (
             SELECT dedup_key FROM transactions WHERE account_id = ${targetId}
           )
        RETURNING id
      `);
      const dedupCollisionsDropped = dedupDropped.rows.length;

      // ---- Step C — move remaining transactions.
      const moved = await tx.execute<{ id: number }>(sql`
        UPDATE transactions
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const transactionsMoved = moved.rows.length;

      // ---- Step D — collapse transfer groups now entirely on target.
      const doomed = await tx.execute<{ transfer_group_id: string }>(sql`
        SELECT transfer_group_id
          FROM transactions
         WHERE transfer_group_id IS NOT NULL
         GROUP BY transfer_group_id
        HAVING COUNT(*) FILTER (WHERE account_id <> ${targetId}) = 0
           AND COUNT(*) > 0
      `);
      const doomedIds = doomed.rows.map((r) => r.transfer_group_id);
      if (doomedIds.length > 0) {
        await tx.execute(sql`
          UPDATE transactions
             SET transfer_group_id = NULL
           WHERE transfer_group_id = ANY(${doomedIds}::uuid[])
        `);
      }
      const transferGroupsCollapsed = doomedIds.length;

      // ---- Step E — repoint side tables (delete colliders, then UPDATE).

      // account_filename_patterns — no unique on account_id alone.
      const patternsRes = await tx.execute<{ id: number }>(sql`
        UPDATE account_filename_patterns
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const patternsMoved = patternsRes.rows.length;

      // balance_checkpoints — unique (account_id, checkpoint_date).
      // Delete source rows whose date collides on target.
      await tx.execute(sql`
        DELETE FROM balance_checkpoints
         WHERE account_id = ${sourceId}
           AND checkpoint_date IN (
             SELECT checkpoint_date FROM balance_checkpoints WHERE account_id = ${targetId}
           )
      `);
      const checkpointsRes = await tx.execute<{ id: number }>(sql`
        UPDATE balance_checkpoints
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const checkpointsMoved = checkpointsRes.rows.length;

      // category_budgets — scoped uniq on (user_id, category_id, period, account_id).
      // Delete source rows that collide on (user_id, category_id, period, target).
      await tx.execute(sql`
        DELETE FROM category_budgets
         WHERE account_id = ${sourceId}
           AND (user_id, category_id, period) IN (
             SELECT user_id, category_id, period
               FROM category_budgets
              WHERE account_id = ${targetId}
           )
      `);
      const budgetsRes = await tx.execute<{ id: number }>(sql`
        UPDATE category_budgets
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const budgetsMoved = budgetsRes.rows.length;

      // file_imports — no unique on account_id alone.
      const importsRes = await tx.execute<{ id: number }>(sql`
        UPDATE file_imports
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const importsMoved = importsRes.rows.length;

      // pdf_statement_templates — unique (fingerprint, account_id).
      // Delete source rows whose fingerprint already exists on target.
      await tx.execute(sql`
        DELETE FROM pdf_statement_templates
         WHERE account_id = ${sourceId}
           AND fingerprint IN (
             SELECT fingerprint FROM pdf_statement_templates WHERE account_id = ${targetId}
           )
      `);
      const templatesRes = await tx.execute<{ id: number }>(sql`
        UPDATE pdf_statement_templates
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const templatesMoved = templatesRes.rows.length;

      // pdf_import_drafts — transient; sweeper purges within 24h anyway.
      const draftsRes = await tx.execute<{ id: number }>(sql`
        UPDATE pdf_import_drafts
           SET account_id = ${targetId}
         WHERE account_id = ${sourceId}
        RETURNING id
      `);
      const draftsMoved = draftsRes.rows.length;

      // ---- Step F — bump target's opening_balance by source's.
      const openingBalanceAdded = source.openingBalance;
      await tx.execute(sql`
        UPDATE accounts
           SET opening_balance = opening_balance + ${openingBalanceAdded}::numeric
         WHERE id = ${targetId}
      `);

      // ---- Step G — delete the source account.
      await tx.execute(sql`DELETE FROM accounts WHERE id = ${sourceId}`);

      return {
        transactionsMoved,
        dedupCollisionsDropped,
        transferGroupsCollapsed,
        patternsMoved,
        checkpointsMoved,
        budgetsMoved,
        importsMoved,
        templatesMoved,
        draftsMoved,
        openingBalanceAdded,
      };
    });

    app.log.info({ sourceId, targetId, uid, counts: merged }, 'account merge complete');
    return { ok: true, merged };
```

The Drizzle export used in the test import is `pdfStatementTemplates` (verified against `backend/src/db/schema.ts:319`). The raw SQL runs against the underlying table `pdf_statement_templates`.

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npx vitest run accounts-merge
```

Expected: all backend cases PASS.

- [ ] **Step 5: Type-check + full suite**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
npm run build && RUN_DB_TESTS=1 npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/src/http/routes/accounts.ts backend/tests/accounts-merge.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(accounts): merge pipeline steps D-G (transfer collapse + side tables + finalize)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Deferred**: the spec's test case 11 ("transactionality on error — inject a mid-pipeline failure and assert nothing is written") is not implemented here. Injecting a synthetic fault would require adding a test-only hook into the route source code, which is invasive and fragile. Postgres transaction semantics (a thrown exception rolls back everything the transaction touched) are trusted upstream.

---

### Task 4: Frontend API client — `mergeAccount()`

**Files:**
- Create: `frontend/src/api/accounts.ts`

**Interfaces:**
- Produces:
  - `MergeResult` interface (matches the backend's `merged` payload).
  - `mergeAccount(sourceId: number, targetId: number): Promise<MergeResult>`.

- [ ] **Step 1: Create the module**

Create `frontend/src/api/accounts.ts`:

```ts
import { api } from './client';

export interface MergeResult {
  transactionsMoved: number;
  dedupCollisionsDropped: number;
  transferGroupsCollapsed: number;
  patternsMoved: number;
  checkpointsMoved: number;
  budgetsMoved: number;
  importsMoved: number;
  templatesMoved: number;
  draftsMoved: number;
  openingBalanceAdded: string;
}

interface MergeResponse {
  ok: true;
  merged: MergeResult;
}

export async function mergeAccount(
  sourceId: number, targetId: number,
): Promise<MergeResult> {
  const res = await api<MergeResponse>(`/api/accounts/${sourceId}/merge`, {
    method: 'POST',
    json: { targetId },
  });
  return res.merged;
}
```

- [ ] **Step 2: Type-check the frontend**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend
npx tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add frontend/src/api/accounts.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(frontend): mergeAccount() API client

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: MergeModal component + tests

**Files:**
- Create: `frontend/src/pages/Accounts/MergeModal.tsx`
- Create: `frontend/src/pages/Accounts/__tests__/MergeModal.test.tsx`

**Interfaces:**
- Consumes:
  - `mergeAccount(sourceId, targetId)` from Task 4.
  - `Account` type from `frontend/src/api/types` (existing).
- Produces:
  - Default export `MergeModal` with props:
    ```ts
    interface MergeModalProps {
      open: boolean;
      source: Account;
      candidates: Account[];  // all other accounts (any currency), filtered internally
      onCancel: () => void;
      onDone: (result: MergeResult) => void;
    }
    ```

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/Accounts/__tests__/MergeModal.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MergeModal } from '../MergeModal';
import type { Account } from '../../../api/types';

const A = (id: number, name: string, currency: string, openingBalance = '0'): Account => ({
  id, name, type: 'checking', currency, openingBalance,
  openingDate: '2025-01-01', displayOrder: 0, createdAt: new Date().toISOString(),
  lockYears: null, currentBalance: '0', availableBalance: '0',
  transactionCount: 0, countedTransactionCount: 0,
});

vi.mock('../../../api/accounts', () => ({
  mergeAccount: vi.fn(),
}));

describe('MergeModal', () => {
  beforeEach(async () => {
    const { mergeAccount } = await import('../../../api/accounts');
    (mergeAccount as any).mockReset();
  });

  it('filters candidates by currency', () => {
    const source = A(1, 'Src', 'EUR');
    const candidates = [A(2, 'AnotherEUR', 'EUR'), A(3, 'ThirdEUR', 'EUR'), A(4, 'USD', 'USD')];
    render(
      <MergeModal open source={source} candidates={candidates}
        onCancel={() => {}} onDone={() => {}} />,
    );
    // The select shows the two EUR candidates, not the USD one.
    expect(screen.getByRole('option', { name: /AnotherEUR/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /ThirdEUR/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /USD/ })).not.toBeInTheDocument();
  });

  it('confirm button disabled until a target is chosen', () => {
    render(
      <MergeModal open source={A(1, 'Src', 'EUR')} candidates={[A(2, 'Tgt', 'EUR')]}
        onCancel={() => {}} onDone={() => {}} />,
    );
    const btn = screen.getByRole('button', { name: /^Fusionner$/ });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    expect(btn).not.toBeDisabled();
  });

  it('calls onDone with the counts on success', async () => {
    const { mergeAccount } = await import('../../../api/accounts');
    (mergeAccount as any).mockResolvedValue({
      transactionsMoved: 3, dedupCollisionsDropped: 0, transferGroupsCollapsed: 0,
      patternsMoved: 0, checkpointsMoved: 0, budgetsMoved: 0,
      importsMoved: 0, templatesMoved: 0, draftsMoved: 0,
      openingBalanceAdded: '10.00',
    });
    const onDone = vi.fn();
    render(
      <MergeModal open source={A(1, 'Src', 'EUR')} candidates={[A(2, 'Tgt', 'EUR')]}
        onCancel={() => {}} onDone={onDone} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Fusionner$/ }));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ transactionsMoved: 3 }));
    });
  });

  it('shows the API error inline and stays open on failure', async () => {
    const { mergeAccount } = await import('../../../api/accounts');
    (mergeAccount as any).mockRejectedValue(new Error('currency mismatch'));
    const onDone = vi.fn();
    render(
      <MergeModal open source={A(1, 'Src', 'EUR')} candidates={[A(2, 'Tgt', 'EUR')]}
        onCancel={() => {}} onDone={onDone} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Fusionner$/ }));
    await waitFor(() => {
      expect(screen.getByText(/currency mismatch/)).toBeInTheDocument();
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend
npx vitest run MergeModal
```

Expected: all four cases FAIL (`Cannot find module '../MergeModal'`).

- [ ] **Step 3: Create the component**

Create `frontend/src/pages/Accounts/MergeModal.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { Account } from '../../api/types';
import { mergeAccount, type MergeResult } from '../../api/accounts';
import { formatAmount } from '../../lib/format';

interface MergeModalProps {
  open: boolean;
  source: Account;
  candidates: Account[];
  onCancel: () => void;
  onDone: (result: MergeResult) => void;
}

export function MergeModal({
  open, source, candidates, onCancel, onDone,
}: MergeModalProps) {
  const [targetId, setTargetId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local state whenever the modal reopens.
  useEffect(() => {
    if (open) {
      setTargetId(null);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  // Esc cancels.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const sameCurrency = useMemo(
    () => candidates.filter((a) => a.id !== source.id && a.currency === source.currency),
    [candidates, source.id, source.currency],
  );
  const target = sameCurrency.find((a) => a.id === targetId) ?? null;

  const submit = async () => {
    if (targetId == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await mergeAccount(source.id, targetId);
      onDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div className="surface w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="display text-xl text-ink-50 mb-2 leading-snug">
          Fusionner <span className="text-ink-200">{source.name}</span> dans un autre compte
        </div>
        <div className="text-sm text-ink-400 mb-4 leading-relaxed">
          Choisis le compte de destination (même devise uniquement).
        </div>

        <label className="block text-xs text-ink-500 mb-1">Destination</label>
        <select
          className="input w-full mb-4"
          value={targetId ?? ''}
          onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
          disabled={busy}
        >
          <option value="">— sélectionner —</option>
          {sameCurrency.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        {target && (
          <ul className="text-sm text-ink-400 space-y-1 mb-4 list-disc list-inside">
            <li>Toutes les transactions du source seront déplacées vers <b>{target.name}</b>.</li>
            <li>
              Le solde d’ouverture ({formatAmount(source.openingBalance, source.currency)}) sera
              ajouté à celui de <b>{target.name}</b>.
            </li>
            <li>
              Les patterns, points de contrôle, budgets et historique d’imports rattachés au source
              seront repointés (les doublons éventuels seront écartés en gardant ceux du target).
            </li>
            <li>Les transferts entre les deux comptes seront cassés (redeviennent des transactions ordinaires).</li>
            <li><b>{source.name}</b> sera supprimé. Cette action est <b>irréversible</b>.</li>
          </ul>
        )}

        {error && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200 mb-4">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>Annuler</button>
          <button
            className="btn-danger"
            onClick={submit}
            disabled={targetId == null || busy}
          >
            {busy ? '…' : 'Fusionner'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend
npx vitest run MergeModal
```

Expected: four cases PASS.

- [ ] **Step 5: Type-check + full frontend suite**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend
npx tsc -p tsconfig.json --noEmit && npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add frontend/src/pages/Accounts/MergeModal.tsx frontend/src/pages/Accounts/__tests__/MergeModal.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(frontend): MergeModal target picker + confirmation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: AccountCard "•••" menu + parent wiring

**Files:**
- Modify: `frontend/src/pages/Accounts/AccountCard.tsx` (add "•••" button + menu popover with a single "Fusionner avec…" item that calls `onMerge?.(a)`)
- Modify: `frontend/src/pages/Accounts/index.tsx` (mount `MergeModal`, keep `mergeSource: Account | null` in state, pass `onMerge={setMergeSource}` to each card, refresh accounts + show toast on `onDone`)

**Interfaces:**
- Consumes: `MergeModal` (Task 5), `Account[]` from the existing query in `Accounts/index.tsx`.
- Produces: no new exports.

**Design note**: the "•••" menu is a `<details>`/`<summary>` combo since that pattern is already used elsewhere in this folder (`BalanceCheckpointsDrawer` uses `<details>` for accordion). Cheap, no dependency, works with keyboard.

- [ ] **Step 1: Modify `AccountCard.tsx` to accept `onMerge` and render the menu**

Edit `frontend/src/pages/Accounts/AccountCard.tsx`.

Update the props interface (both the destructuring and the type):

```tsx
export function AccountCard({
  account: a,
  onEdit,
  onMerge,
  onExpand,
  expanded,
}: {
  account: Account;
  onEdit: (account: Account) => void;
  onMerge?: (account: Account) => void;
  onExpand: (id: number) => void;
  expanded: boolean;
}) {
```

Inside the top-right cluster (`<div className="absolute top-3 right-3 flex items-center gap-1">`), after the "modifier" button and before the closing `</div>`, add:

```tsx
        {onMerge && (
          <details className="relative ml-1">
            <summary
              className="p-1 rounded text-ink-600 hover:text-ink-100 hover:bg-ink-900 transition cursor-pointer list-none"
              title="Actions"
              aria-label={`Actions pour ${a.name}`}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                <circle cx="6" cy="2" r="1" />
                <circle cx="6" cy="6" r="1" />
                <circle cx="6" cy="10" r="1" />
              </svg>
            </summary>
            <div className="absolute right-0 mt-1 min-w-[10rem] surface p-1 z-10">
              <button
                type="button"
                className="block w-full text-left px-2 py-1 text-sm text-ink-200 hover:bg-ink-900 rounded"
                onClick={(e) => {
                  e.preventDefault();
                  // Close the <details> before firing.
                  (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                  onMerge(a);
                }}
              >
                Fusionner avec…
              </button>
            </div>
          </details>
        )}
```

- [ ] **Step 2: Wire the modal into `Accounts/index.tsx`**

Edit `frontend/src/pages/Accounts/index.tsx`. Read the file first to see its existing structure — find where the accounts list is mapped into `<AccountCard>` elements and where `useQueryClient()` is invoked (or add it if missing).

Add imports at the top of the file:

```tsx
import { useState } from 'react';
import { MergeModal } from './MergeModal';
import type { MergeResult } from '../../api/accounts';
```

Add state near the existing `useState` calls (the component already exposes `const qc = useQueryClient();` and `const accountsQ = useQuery({ queryKey: ['accounts'], … });` — reuse both):

```tsx
  const [mergeSource, setMergeSource] = useState<Account | null>(null);
```

Pass the callback to each `<AccountCard>`:

```tsx
  onMerge={setMergeSource}
```

Mount the modal near the existing `<ConfirmDialog>` at the bottom of the render tree (before the outermost closing tag):

```tsx
  {mergeSource && (
    <MergeModal
      open={true}
      source={mergeSource}
      candidates={accountsQ.data?.accounts ?? []}
      onCancel={() => setMergeSource(null)}
      onDone={(result: MergeResult) => {
        setMergeSource(null);
        void qc.invalidateQueries({ queryKey: ['accounts'] });
        void qc.invalidateQueries({ queryKey: ['reports'] });
        console.info(
          `Fusion réussie : ${result.transactionsMoved} transactions déplacées, ` +
          `${result.dedupCollisionsDropped} doublons ignorés, ` +
          `solde d'ouverture ajouté ${result.openingBalanceAdded}.`,
        );
      }}
    />
  )}
```

The `['reports']` invalidation matches the pattern used by the existing create/update mutations in this file (any change to accounts invalidates the reports cache).

- [ ] **Step 3: Type-check frontend**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend
npx tsc -p tsconfig.json --noEmit
```

Expected: PASS. If any TS error shows the query key is different from `['accounts']`, adjust the invalidate call to match and re-run.

- [ ] **Step 4: Run frontend suite (existing tests should still pass)**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend
npx vitest run
```

Expected: PASS (the existing `AccountCard`/`Accounts` tests don't assert on the "•••" menu, and `onMerge` is optional so any test rendering `AccountCard` without it keeps working).

- [ ] **Step 5: Manual smoke test (optional, if the dev server is up)**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend
npm run dev
```

Open `http://<homelab-host>:5173/accounts`, create two accounts of the same currency, add a couple of transactions to one, then use the "•••" menu → "Fusionner avec…" → pick the target → confirm. Verify the source vanishes and its transactions appear under the target. Postgres must be up for this smoke test; if it isn't, skip this step.

- [ ] **Step 6: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add frontend/src/pages/Accounts/AccountCard.tsx frontend/src/pages/Accounts/index.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(frontend): AccountCard ••• menu wires MergeModal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Notes on execution

- **Postgres:** if OrbStack/the dev DB is down, the `RUN_DB_TESTS=1` steps in Tasks 1–3 can't be run locally. Substitute with `npm run build` for a type-check pass and let GitHub CI verify against its own Postgres service. Do NOT launch container runtimes.
- **Cross-file test races:** every backend test case creates its own user via `POST /api/onboarding/create` because `tests/mcp/store.test.ts` wipes the `users` table in its `beforeAll` and Vitest runs test files in parallel. Do NOT rely on state left by earlier `it` blocks in different describe blocks — always fresh-create per case OR per describe.
- **Commit identity:** every commit uses `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`. Do NOT modify `.git/config`.
- **Push:** stay local. Push only when the user explicitly asks.
