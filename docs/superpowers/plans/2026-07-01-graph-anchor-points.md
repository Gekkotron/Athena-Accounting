# Graph Anchor Points (Balance Checkpoints) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-account manual balance checkpoints, rendered as distinct markers on the Dashboard chart with drift-vs-computed detection, editable inline from the Comptes page.

**Architecture:** New `balance_checkpoints` table nested under `accounts` (with denormalized `user_id` matching every other child table). Four REST routes under `/api/accounts/:id/balance-checkpoints`. `BalanceChart` gains an optional `checkpoints` prop and renders diamonds + drift guides. Dashboard loads checkpoints only when a specific account is scoped. Accounts page grows an expandable drawer per card. No new report endpoint — the chart computes drift client-side against the timeseries it already has.

**Tech Stack:** Fastify 5 + Zod + Drizzle ORM + Postgres 16 (backend); React 18 + Vite + TanStack Query + Tailwind + custom SVG chart (frontend); Vitest 2 for backend tests; `docker compose up` for manual verification.

**Spec:** `docs/superpowers/specs/2026-07-01-graph-anchor-point-design.md`

## Global Constraints

- Numeric precision project-wide is `numeric(14, 2)` — match this for `expected_amount`.
- Every child table since migration `0007` carries `user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE` for direct filtering. Follow the pattern.
- SQL migrations live in `backend/src/db/migrations/NNNN_*.sql`, applied at boot in lexicographic order by `runMigrations()`. Next number is `0009`.
- Routes require `app.addHook('preHandler', app.requireAuth)` at the top of the plugin. Get the user id with `userId(req)` from `../plugins/auth.js`.
- Query builder: Drizzle ORM. Follow the `account-patterns.ts` style: `db.select().from(...).where(and(eq(col, val), ...))` with `.returning()` on writes.
- Return shapes: list → `{ checkpoints: [...] }`, single → `{ checkpoint: {...} }`, delete/reorder → `{ ok: true }`. Errors → `{ error: '...' }` optionally with `issues`.
- Frontend money strings stay as strings from the API and are parsed with `Number(...)` only at the render boundary. Match the pattern used for `openingBalance`.
- Tolerance for drift: hard-coded `0.01`. No config.
- Tests run with `RUN_DB_TESTS=1 npm test --workspace backend` (env var gates DB-dependent tests). Follow the `describe.skipIf(!RUN)` pattern in existing route tests.
- Commit messages follow the repo style: `<type>(<scope>): <short-summary>` — e.g. `feat(reports)`, `docs(spec)`. Every commit ends with the `Co-Authored-By` trailer.
- Public-safe: do not commit IPs, hostnames, credentials, or PII. The project is going public.

---

## Task 1 — Database migration + Drizzle schema

**Files:**
- Create: `backend/src/db/migrations/0009_balance_checkpoints.sql`
- Modify: `backend/src/db/schema.ts` (add `balanceCheckpoints` table export at the bottom, after `pdfImportDrafts`)

**Interfaces:**
- Consumes: `accounts.id`, `users.id` (existing FKs).
- Produces: `balance_checkpoints` table; `balanceCheckpoints` Drizzle export importable as `import { balanceCheckpoints } from '../../db/schema.js';`.

- [ ] **Step 1: Write the migration SQL**

Create `backend/src/db/migrations/0009_balance_checkpoints.sql`:

```sql
-- Manual reconciliation checkpoints per account. The user records a known
-- real balance on a given date (typically from a bank statement) and the
-- Dashboard chart plots it as a distinct marker. If the computed cumulative
-- diverges beyond one cent, the marker renders in a drift style with a short
-- guide line to the actual value. UI-only feature — no aggregate is derived
-- from this table server-side.

CREATE TABLE balance_checkpoints (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  checkpoint_date  DATE NOT NULL,
  expected_amount  NUMERIC(14, 2) NOT NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, checkpoint_date)
);

CREATE INDEX balance_checkpoints_account_idx ON balance_checkpoints (account_id);
CREATE INDEX balance_checkpoints_user_idx    ON balance_checkpoints (user_id);
```

- [ ] **Step 2: Apply the migration locally**

Run:
```bash
cd backend && DATABASE_URL="$(grep '^DATABASE_URL=' ../.env | cut -d= -f2-)" npx tsx -e 'import("./src/db/migrate.js").then(m => m.runMigrations())'
```
Expected: `[migrate] applying 0009_balance_checkpoints.sql` then `[migrate] all migrations applied`. Verify with `psql "$DATABASE_URL" -c '\d balance_checkpoints'` — you should see the four indices Postgres creates for the PK, both single-column indices, and the unique constraint.

- [ ] **Step 3: Add the Drizzle model**

Append to `backend/src/db/schema.ts` (below `pdfImportDrafts`):

```ts
// ---------------------------------------------------------------------------
// balance_checkpoints — manual reconciliation markers per account.
// Displayed as diamonds on the Dashboard chart when a specific account is
// scoped; drifts against the computed cumulative render in an amber style.
// ---------------------------------------------------------------------------

export const balanceCheckpoints = pgTable(
  'balance_checkpoints',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    checkpointDate: date('checkpoint_date').notNull(),
    expectedAmount: numeric('expected_amount', { precision: 14, scale: 2 }).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqAccountDate: uniqueIndex('balance_checkpoints_account_date_uq').on(
      t.accountId,
      t.checkpointDate,
    ),
    idxAccount: index('balance_checkpoints_account_idx').on(t.accountId),
    idxUser: index('balance_checkpoints_user_idx').on(t.userId),
  }),
);
```

The unique index name (`balance_checkpoints_account_date_uq`) is chosen for Drizzle's introspection consistency; the SQL migration's inline `UNIQUE (account_id, checkpoint_date)` produces an auto-named constraint but functionally the same shape.

- [ ] **Step 4: TypeScript check**

Run:
```bash
cd backend && npx tsc -p tsconfig.json --noEmit
```
Expected: no output (0 errors).

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0009_balance_checkpoints.sql backend/src/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(schema): add balance_checkpoints table for graph anchor points

Nested under accounts (with denormalized user_id per project convention).
Unique per (account, date). Migration 0009.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Backend routes + tests

**Files:**
- Create: `backend/src/http/routes/balance-checkpoints.ts`
- Modify: `backend/src/server.ts` (import + register the new plugin)
- Create: `backend/tests/balance-checkpoints-route.test.ts`

**Interfaces:**
- Consumes: `balanceCheckpoints` from Task 1; `userId(req)` from `../plugins/auth.js`; `db` from `../../db/client.js`.
- Produces: four HTTP routes (see spec §Backend API). Frontend Task 3 consumes these.

- [ ] **Step 1: Write the failing test suite**

Create `backend/tests/balance-checkpoints-route.test.ts`:

```ts
// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountAId: number;
let accountBId: number;

describe.skipIf(!RUN)('/api/accounts/:id/balance-checkpoints', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'cpts', password: 'checkpoints-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'cpts', password: 'checkpoints-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const a = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'A', type: 'current', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountAId = a.json().account.id;
    const b = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'B', type: 'savings', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountBId = b.json().account.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { balanceCheckpoints } = await import('../src/db/schema.js');
    await db.delete(balanceCheckpoints);
  });

  it('creates, lists, updates, and deletes a checkpoint', async () => {
    const create = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-12-02', expectedAmount: '2000.00', note: 'relevé nov' },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json().checkpoint;
    expect(created.checkpointDate).toBe('2025-12-02');
    expect(created.expectedAmount).toBe('2000.00');
    expect(created.note).toBe('relevé nov');

    const list = await app.inject({
      method: 'GET', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().checkpoints).toHaveLength(1);

    const put = await app.inject({
      method: 'PUT', url: `/api/accounts/${accountAId}/balance-checkpoints/${created.id}`,
      headers: { cookie }, payload: { expectedAmount: '2050.50', note: '' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().checkpoint.expectedAmount).toBe('2050.50');
    expect(put.json().checkpoint.note).toBeNull();

    const del = await app.inject({
      method: 'DELETE', url: `/api/accounts/${accountAId}/balance-checkpoints/${created.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({
      method: 'GET', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
    });
    expect(after.json().checkpoints).toHaveLength(0);
  });

  it('rejects duplicate (account, date) with 409', async () => {
    await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-06-01', expectedAmount: '100.00' },
    });
    const dup = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-06-01', expectedAmount: '200.00' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('checkpoint_exists');
    expect(dup.json().date).toBe('2025-06-01');
  });

  it('rejects invalid input with 400', async () => {
    const bad = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '02-12-2025', expectedAmount: 'not-a-number' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('isolates checkpoints across accounts: PUT with mismatched (id, cpId) is 404', async () => {
    const cp = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-07-01', expectedAmount: '10.00' },
    });
    const cpId = cp.json().checkpoint.id;
    const cross = await app.inject({
      method: 'PUT', url: `/api/accounts/${accountBId}/balance-checkpoints/${cpId}`,
      headers: { cookie }, payload: { expectedAmount: '99.00' },
    });
    expect(cross.statusCode).toBe(404);
  });

  it('cascades on account deletion', async () => {
    const tmpAcc = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'ToDelete', type: 'current', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    const tmpId = tmpAcc.json().account.id;
    await app.inject({
      method: 'POST', url: `/api/accounts/${tmpId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-08-01', expectedAmount: '5.00' },
    });
    await app.inject({ method: 'DELETE', url: `/api/accounts/${tmpId}`, headers: { cookie } });

    const { db } = await import('../src/db/client.js');
    const { balanceCheckpoints } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.accountId, tmpId));
    expect(rows).toHaveLength(0);
  });

  it('rejects a note longer than 200 chars with 400', async () => {
    const bad = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-09-01', expectedAmount: '1.00', note: 'x'.repeat(201) },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('trims a whitespace-only note to null', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/accounts/${accountAId}/balance-checkpoints`,
      headers: { cookie },
      payload: { checkpointDate: '2025-10-01', expectedAmount: '1.00', note: '   ' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().checkpoint.note).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npx vitest run tests/balance-checkpoints-route.test.ts
```
Expected: FAIL — routes don't exist yet, all requests return 404.

- [ ] **Step 3: Implement the routes plugin**

Create `backend/src/http/routes/balance-checkpoints.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, balanceCheckpoints } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';

const decimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date YYYY-MM-DD');

const CreateBody = z.object({
  checkpointDate: isoDate,
  expectedAmount: decimal,
  // Trim, treat empty/whitespace-only as omitted, cap length. Stored NULL when absent.
  note: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= 200, 'note too long (max 200)')
    .transform((s) => (s.length === 0 ? null : s))
    .optional()
    .nullable(),
});

const UpdateBody = z.object({
  expectedAmount: decimal.optional(),
  note: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= 200, 'note too long (max 200)')
    .transform((s) => (s.length === 0 ? null : s))
    .optional()
    .nullable(),
});

const AccountIdParam = z.object({ id: z.coerce.number().int().positive() });
const CpIdParam = z.object({
  id: z.coerce.number().int().positive(),
  cpId: z.coerce.number().int().positive(),
});

function parseAccountId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = AccountIdParam.safeParse(req.params);
  if (!r.success) {
    reply.code(400).send({ error: 'invalid id' });
    return null;
  }
  return r.data.id;
}

function parseCpParams(
  req: FastifyRequest,
  reply: FastifyReply,
): { accountId: number; cpId: number } | null {
  const r = CpIdParam.safeParse(req.params);
  if (!r.success) {
    reply.code(400).send({ error: 'invalid id' });
    return null;
  }
  return { accountId: r.data.id, cpId: r.data.cpId };
}

async function ensureAccountOwned(uid: number, accountId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, uid)));
  return !!row;
}

function serialize(row: typeof balanceCheckpoints.$inferSelect) {
  return {
    id: row.id,
    accountId: row.accountId,
    checkpointDate: row.checkpointDate,
    expectedAmount: row.expectedAmount,
    note: row.note,
    createdAt: row.createdAt,
  };
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string';
}

export async function balanceCheckpointsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // GET — list checkpoints for an account, oldest first.
  app.get('/api/accounts/:id/balance-checkpoints', async (req, reply) => {
    const uid = userId(req);
    const accountId = parseAccountId(req, reply);
    if (accountId === null) return;
    if (!(await ensureAccountOwned(uid, accountId))) {
      return reply.code(404).send({ error: 'not found' });
    }
    const rows = await db
      .select()
      .from(balanceCheckpoints)
      .where(and(
        eq(balanceCheckpoints.userId, uid),
        eq(balanceCheckpoints.accountId, accountId),
      ))
      .orderBy(asc(balanceCheckpoints.checkpointDate));
    return { checkpoints: rows.map(serialize) };
  });

  // POST — create a new checkpoint. 409 on (account, date) collision.
  app.post('/api/accounts/:id/balance-checkpoints', async (req, reply) => {
    const uid = userId(req);
    const accountId = parseAccountId(req, reply);
    if (accountId === null) return;
    if (!(await ensureAccountOwned(uid, accountId))) {
      return reply.code(404).send({ error: 'not found' });
    }
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    try {
      const [created] = await db
        .insert(balanceCheckpoints)
        .values({
          userId: uid,
          accountId,
          checkpointDate: parsed.data.checkpointDate,
          expectedAmount: parsed.data.expectedAmount,
          note: parsed.data.note ?? null,
        })
        .returning();
      return reply.code(201).send({ checkpoint: serialize(created!) });
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({
          error: 'checkpoint_exists',
          date: parsed.data.checkpointDate,
        });
      }
      throw err;
    }
  });

  // PUT — patch expectedAmount and/or note. Date is immutable — the client
  // deletes + recreates to move a checkpoint.
  app.put('/api/accounts/:id/balance-checkpoints/:cpId', async (req, reply) => {
    const uid = userId(req);
    const params = parseCpParams(req, reply);
    if (!params) return;
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const patch: Partial<typeof balanceCheckpoints.$inferInsert> = {};
    if (parsed.data.expectedAmount !== undefined) patch.expectedAmount = parsed.data.expectedAmount;
    if (parsed.data.note !== undefined) patch.note = parsed.data.note;
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }
    const [updated] = await db
      .update(balanceCheckpoints)
      .set(patch)
      .where(and(
        eq(balanceCheckpoints.id, params.cpId),
        eq(balanceCheckpoints.accountId, params.accountId),
        eq(balanceCheckpoints.userId, uid),
      ))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return { checkpoint: serialize(updated) };
  });

  // DELETE — 204 on success, 404 if the (id, cpId) pair isn't owned.
  app.delete('/api/accounts/:id/balance-checkpoints/:cpId', async (req, reply) => {
    const uid = userId(req);
    const params = parseCpParams(req, reply);
    if (!params) return;
    const [deleted] = await db
      .delete(balanceCheckpoints)
      .where(and(
        eq(balanceCheckpoints.id, params.cpId),
        eq(balanceCheckpoints.accountId, params.accountId),
        eq(balanceCheckpoints.userId, uid),
      ))
      .returning({ id: balanceCheckpoints.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Register the plugin**

Modify `backend/src/server.ts` — add the import next to the other route imports, and register it after `patternRoutes`:

```ts
// Near the other route imports (top of file):
import { balanceCheckpointsRoutes } from './http/routes/balance-checkpoints.js';

// Inside build(), after `await app.register(patternRoutes);`:
await app.register(balanceCheckpointsRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npx vitest run tests/balance-checkpoints-route.test.ts
```
Expected: all seven tests pass.

- [ ] **Step 6: Full backend test suite**

Run:
```bash
cd backend && RUN_DB_TESTS=1 npx vitest run
```
Expected: full suite green — new tests do not break existing ones (in particular, the `afterEach` truncation is scoped to `balanceCheckpoints` only).

- [ ] **Step 7: Commit**

```bash
git add backend/src/http/routes/balance-checkpoints.ts backend/src/server.ts backend/tests/balance-checkpoints-route.test.ts
git commit -m "$(cat <<'EOF'
feat(checkpoints): CRUD routes under /api/accounts/:id/balance-checkpoints

Nested REST, zod-validated, 409 on (account, date) collision, 404 on
cross-account access. Full test coverage under RUN_DB_TESTS=1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Frontend API client + types

**Files:**
- Modify: `frontend/src/api/types.ts` (add `BalanceCheckpoint`)
- Create: `frontend/src/api/checkpoints.ts`

**Interfaces:**
- Consumes: `api` from `./client.js`.
- Produces: `BalanceCheckpoint` type; `listCheckpoints`, `createCheckpoint`, `updateCheckpoint`, `deleteCheckpoint`. Tasks 5, 6 consume these.

- [ ] **Step 1: Add the type**

Append to `frontend/src/api/types.ts`:

```ts
export interface BalanceCheckpoint {
  id: number;
  accountId: number;
  checkpointDate: string;   // YYYY-MM-DD
  expectedAmount: string;   // fixed-point string, per project convention
  note: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: Add the typed API wrappers**

Create `frontend/src/api/checkpoints.ts`:

```ts
import { api } from './client';
import type { BalanceCheckpoint } from './types';

export function listCheckpoints(accountId: number) {
  return api<{ checkpoints: BalanceCheckpoint[] }>(
    `/api/accounts/${accountId}/balance-checkpoints`,
  );
}

export function createCheckpoint(
  accountId: number,
  body: { checkpointDate: string; expectedAmount: string; note?: string | null },
) {
  return api<{ checkpoint: BalanceCheckpoint }>(
    `/api/accounts/${accountId}/balance-checkpoints`,
    { method: 'POST', json: body },
  );
}

export function updateCheckpoint(
  accountId: number,
  cpId: number,
  patch: { expectedAmount?: string; note?: string | null },
) {
  return api<{ checkpoint: BalanceCheckpoint }>(
    `/api/accounts/${accountId}/balance-checkpoints/${cpId}`,
    { method: 'PUT', json: patch },
  );
}

export function deleteCheckpoint(accountId: number, cpId: number) {
  return api<void>(`/api/accounts/${accountId}/balance-checkpoints/${cpId}`, {
    method: 'DELETE',
  });
}
```

- [ ] **Step 3: TypeScript check**

Run:
```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: no errors (the module compiles even though nothing imports it yet).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/checkpoints.ts
git commit -m "$(cat <<'EOF'
feat(checkpoints): typed API client wrappers + BalanceCheckpoint type

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `BalanceChart` renders checkpoints

**Files:**
- Modify: `frontend/src/components/BalanceChart.tsx`

**Interfaces:**
- Consumes: `data[]` internal to the chart (post forward-fill).
- Produces: new optional `checkpoints` prop shape:
  ```ts
  { date: string; expectedAmount: number; note?: string }[]
  ```
  Dashboard (Task 5) passes this.

- [ ] **Step 1: Extend the `Props` interface and pull the prop through**

Modify `frontend/src/components/BalanceChart.tsx` — change the `Props` interface and the function signature:

```ts
interface Props {
  points: BalancePoint[];
  currency: string;
  height?: number;
  checkpoints?: { date: string; expectedAmount: number; note?: string }[];
}

export function BalanceChart({ points, currency, height = 240, checkpoints }: Props) {
```

- [ ] **Step 2: Compute per-checkpoint drift**

Immediately after the `xScale` / `yScale` definitions (around the current `const path = data.map(...)` line), add:

```ts
// Attach each in-range checkpoint to its "actual" cumulative on that date,
// using the same forward-fill semantics as the main series (latest bucket
// with bucket_date <= checkpointDate). Anything outside the plotted range
// is silently dropped — no orphan dots hanging off the edges.
const CHECKPOINT_TOLERANCE = 0.01;
const firstDate = data[0]!.date;
const lastDate = data[data.length - 1]!.date;
const marks = (checkpoints ?? [])
  .filter(
    (c) =>
      c.date >= firstDate &&
      c.date <= lastDate &&
      Number.isFinite(c.expectedAmount),
  )
  .map((c) => {
    // Binary search for the latest bucket <= c.date.
    let lo = 0;
    let hi = data.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (data[mid]!.date <= c.date) lo = mid;
      else hi = mid - 1;
    }
    const actual = data[lo]!.value;
    const delta = c.expectedAmount - actual;
    const drift = Math.abs(delta) >= CHECKPOINT_TOLERANCE;
    return { ...c, actual, delta, drift };
  });
```

- [ ] **Step 3: Render the diamonds + drift guides**

Insert a new SVG group inside the existing `<svg>`, *after* the main `<path d={path}>` line and *before* the `end marker` circle group:

```tsx
{/* Balance checkpoints — diamond markers + optional drift guide */}
{marks.map((m) => {
  const cx = xScale(
    // Use the checkpoint's own X, not the bucket's. Solve for i such that
    // xScale(i) reflects the day fraction between firstDate and lastDate.
    ((new Date(m.date).getTime() - new Date(firstDate).getTime()) /
      (new Date(lastDate).getTime() - new Date(firstDate).getTime())) *
      (data.length - 1),
  );
  const cyExpected = yScale(m.expectedAmount);
  const cyActual = yScale(m.actual);
  const color = m.drift ? '#f6c177' : '#7dd3c0'; // amber vs. sage
  const fill = m.drift ? color : 'none';
  return (
    <g key={`cp-${m.date}`} pointerEvents="none">
      {m.drift && (
        <line
          x1={cx}
          y1={cyExpected}
          x2={cx}
          y2={cyActual}
          stroke={color}
          strokeDasharray="3 3"
          strokeWidth="1"
          opacity="0.8"
        />
      )}
      {/* Diamond = rotated 4-sided path centered on (cx, cyExpected) */}
      <path
        d={`M ${cx} ${cyExpected - 5} L ${cx + 5} ${cyExpected} L ${cx} ${cyExpected + 5} L ${cx - 5} ${cyExpected} Z`}
        fill={fill}
        stroke={color}
        strokeWidth="2"
      />
      {m.drift && (
        <circle cx={cx} cy={cyActual} r="2" fill={color} />
      )}
    </g>
  );
})}
```

Colors are hard-coded literals here matching the sage / amber tokens already used elsewhere in the chart. If `index.css` gains named CSS vars for these later, swap them in.

- [ ] **Step 4: Extend the hover tooltip**

Modify the tooltip block near the bottom of the component. Locate the closest checkpoint (if any) to the currently hovered bucket, and append a second line when close enough:

Add above `return` (just after `const hovered = hover !== null ? data[hover.idx] : null;`):

```ts
// If the hovered X is within ~12 viewBox units of a checkpoint's X, show
// the expected/actual/delta line in the tooltip.
const HOVER_PROXIMITY_VB = 12;
const hoveredCheckpoint = (() => {
  if (hover === null) return null;
  const hoveredX = xScale(hover.idx);
  let closest: (typeof marks)[number] | null = null;
  let closestDist = Infinity;
  for (const m of marks) {
    const cx = xScale(
      ((new Date(m.date).getTime() - new Date(firstDate).getTime()) /
        (new Date(lastDate).getTime() - new Date(firstDate).getTime())) *
        (data.length - 1),
    );
    const d = Math.abs(cx - hoveredX);
    if (d < closestDist && d <= HOVER_PROXIMITY_VB) {
      closest = m;
      closestDist = d;
    }
  }
  return closest;
})();
```

Then modify the tooltip JSX block (currently the `<div className="absolute pointer-events-none surface ...">`) to render an extra section when `hoveredCheckpoint` is set:

```tsx
{hoveredCheckpoint && (
  <div className="mt-1 pt-1 border-t border-ink-800/60 font-mono text-[10px] text-ink-500">
    {hoveredCheckpoint.drift ? (
      <>
        <div>attendu · <span className="text-ink-300">{formatAmount(hoveredCheckpoint.expectedAmount, currency)}</span></div>
        <div>réel · <span className="text-ink-300">{formatAmount(hoveredCheckpoint.actual, currency)}</span></div>
        <div className="text-amber-300">écart · {formatAmount(hoveredCheckpoint.delta, currency)}</div>
      </>
    ) : (
      <div className="text-sage-300">attendu ✓ {formatAmount(hoveredCheckpoint.expectedAmount, currency)}</div>
    )}
  </div>
)}
```

Insert this new block *inside* the existing tooltip `<div>`, after the amount `<div>` that shows `hovered.value`.

- [ ] **Step 5: TypeScript check**

Run:
```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 6: Manual smoke test**

Start the dev stack:
```bash
docker compose up --build
```
Wait for `[migrate] all migrations applied`. Open <http://127.0.0.1:8000>. Login. The chart on the Dashboard should render **exactly as before** — no visible change since no code path passes `checkpoints` yet. Verify no console errors.

Kill the stack with `Ctrl-C`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/BalanceChart.tsx
git commit -m "$(cat <<'EOF'
feat(chart): render optional checkpoint diamonds + drift guides

BalanceChart accepts a checkpoints prop. In-range entries render as
sage diamonds (matched) or amber diamonds + dashed guide to actual
(drift, |delta| >= 0.01). Hover tooltip grows an attendu/réel/écart
block when the pinned bucket is within 12 viewBox units.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Dashboard wires checkpoints for the scoped account

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `listCheckpoints` from Task 3; `BalanceChart` checkpoints prop from Task 4.
- Produces: (no new exports).

- [ ] **Step 1: Add the query**

Modify `frontend/src/pages/Dashboard.tsx`. Add an import for the API wrapper and type near the existing imports:

```ts
import { listCheckpoints } from '../api/checkpoints';
import type { BalanceCheckpoint } from '../api/types';
```

Then, after the existing `seriesQ` query definition, add:

```ts
// Checkpoints for the currently scoped account. Skipped entirely when scope
// is 'all' — checkpoints are per-account by design.
const checkpointsQ = useQuery({
  queryKey: ['balance-checkpoints', chartScope],
  queryFn: () => listCheckpoints(chartScope as number),
  enabled: chartScope !== 'all',
});

const chartCheckpoints = useMemo(() => {
  if (chartScope === 'all') return undefined;
  const raw = checkpointsQ.data?.checkpoints ?? [];
  return raw.map((c: BalanceCheckpoint) => ({
    date: c.checkpointDate,
    expectedAmount: Number(c.expectedAmount),
    note: c.note ?? undefined,
  }));
}, [checkpointsQ.data, chartScope]);
```

- [ ] **Step 2: Pass the array to the chart**

Change the existing `<BalanceChart>` invocation:

```tsx
<BalanceChart points={chartPoints} currency={chartCurrency} checkpoints={chartCheckpoints} />
```

- [ ] **Step 3: Add the drift-count caption**

Below the `<BalanceChart>` line but still inside its wrapping `<section>`, add:

```tsx
{chartCheckpoints && chartCheckpoints.length > 0 && (
  <div className="mt-3 font-mono text-[11px] text-ink-500 flex items-center gap-3">
    <span>
      {chartCheckpoints.length} point{chartCheckpoints.length > 1 ? 's' : ''} de contrôle
    </span>
    {(() => {
      // Client-side drift preview: recompute against the last known cumulative
      // to show a "K drift(s)" tag. Cheap enough on a handful of checkpoints.
      const points = chartPoints.filter((p) => p.currency === chartCurrency);
      if (points.length === 0) return null;
      const sorted = [...points].sort((a, b) => a.bucket.localeCompare(b.bucket));
      let drifts = 0;
      for (const cp of chartCheckpoints) {
        // Binary search for the latest bucket <= cp.date.
        let lo = 0;
        let hi = sorted.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >>> 1;
          if (sorted[mid]!.bucket <= cp.date) lo = mid;
          else hi = mid - 1;
        }
        if (Math.abs(cp.expectedAmount - Number(sorted[lo]!.cumulative)) >= 0.01) drifts++;
      }
      return drifts > 0 ? <span className="text-amber-300">· {drifts} drift{drifts > 1 ? 's' : ''}</span> : null;
    })()}
  </div>
)}
```

- [ ] **Step 4: TypeScript check**

Run:
```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 5: Manual verify**

```bash
docker compose up --build
```
Open <http://127.0.0.1:8000>. Login. Currently the DB has no checkpoints, so the Dashboard should render exactly as before. Switch the chart scope selector between "Tous les comptes" and a specific account — nothing should crash and the caption stays hidden (no checkpoints yet).

Now seed one row from `psql`:
```bash
psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" -c \
  "INSERT INTO balance_checkpoints (user_id, account_id, checkpoint_date, expected_amount)
   VALUES (1, 1, current_date - INTERVAL '30 days', 999999.99);"
```
(Adjust the `user_id` / `account_id` to match your data — check with `psql ... -c 'select id, user_id, name from accounts;'`.)

Reload the Dashboard, switch the chart scope to that account. Expect: one **amber diamond** with a dashed line down to the actual curve, and the caption reads `1 point de contrôle · 1 drift`.

Delete the seed row before committing:
```bash
psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" -c "DELETE FROM balance_checkpoints;"
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): wire balance checkpoints into the chart

Query fires only when a specific account is scoped. Passes mapped
array to BalanceChart and shows a subtle N-point/K-drift caption
below the graph.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Accounts drawer for CRUD

**Files:**
- Modify: `frontend/src/pages/Accounts.tsx` (add `<BalanceCheckpointsDrawer>` subcomponent + expansion state per card)

**Interfaces:**
- Consumes: `listCheckpoints`, `createCheckpoint`, `updateCheckpoint`, `deleteCheckpoint` from Task 3.
- Produces: (no new exports).

- [ ] **Step 1: Add imports and expansion state**

Modify `frontend/src/pages/Accounts.tsx`. Add near the existing imports:

```ts
import { listCheckpoints, createCheckpoint, updateCheckpoint, deleteCheckpoint } from '../api/checkpoints';
import type { BalanceCheckpoint } from '../api/types';
```

Inside the `Accounts` component function, at the top alongside the other `useState` calls, add:

```ts
// One Set for expanded-drawer account ids. Rendering many cards at once, so a
// Set keeps toggling O(log n) and avoids per-card boolean state.
const [checkpointsOpen, setCheckpointsOpen] = useState<Set<number>>(new Set());
const toggleCheckpoints = (id: number) =>
  setCheckpointsOpen((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
```

- [ ] **Step 2: Render the toggle + drawer inside each account card**

Locate the account card's bottom row (currently the transaction counter and delete/modifier row — around line 350–390). Immediately *below* that row and still inside the same card `<div>`, add:

```tsx
<div className="mt-3 pt-3 border-t border-ink-800/60">
  <button
    type="button"
    className="flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-100 transition"
    onClick={() => toggleCheckpoints(a.id)}
    aria-expanded={checkpointsOpen.has(a.id)}
  >
    <span className={`inline-block transition-transform ${checkpointsOpen.has(a.id) ? 'rotate-90' : ''}`}>▸</span>
    Points de contrôle
  </button>
  {checkpointsOpen.has(a.id) && (
    <BalanceCheckpointsDrawer accountId={a.id} currency={a.currency} />
  )}
</div>
```

- [ ] **Step 3: Add the `BalanceCheckpointsDrawer` subcomponent**

At the bottom of `Accounts.tsx`, alongside `PatternsSection`, add:

```tsx
function BalanceCheckpointsDrawer({ accountId, currency }: { accountId: number; currency: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['balance-checkpoints', accountId],
    queryFn: () => listCheckpoints(accountId),
  });

  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newAmount, setNewAmount] = useState('');
  const [newNote, setNewNote] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createCheckpoint(accountId, {
        checkpointDate: newDate,
        expectedAmount: newAmount,
        note: newNote || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-checkpoints', accountId] });
      setNewAmount('');
      setNewNote('');
      setCreateError(null);
    },
    onError: (err: unknown) => {
      const status = (err as { status?: number })?.status;
      const message = (err as { message?: string })?.message;
      if (status === 409) setCreateError('Un point de contrôle existe déjà à cette date.');
      else setCreateError(message ?? 'Erreur');
    },
  });

  const del = useMutation({
    mutationFn: (cpId: number) => deleteCheckpoint(accountId, cpId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['balance-checkpoints', accountId] }),
  });

  const patch = useMutation({
    mutationFn: (args: { cpId: number; patch: { expectedAmount?: string; note?: string | null } }) =>
      updateCheckpoint(accountId, args.cpId, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['balance-checkpoints', accountId] }),
  });

  const rows = q.data?.checkpoints ?? [];

  return (
    <div className="mt-2">
      {rows.length === 0 && !q.isLoading && (
        <div className="text-[11px] text-ink-500 italic mb-2">
          Aucun point de contrôle. Ajoutez-en un pour vérifier vos soldes contre un relevé.
        </div>
      )}
      {rows.length > 0 && (
        <table className="w-full text-[11px] font-mono mb-2">
          <thead>
            <tr className="text-ink-600">
              <th className="text-left font-normal">date</th>
              <th className="text-right font-normal">attendu</th>
              <th className="text-left font-normal pl-3">note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c: BalanceCheckpoint) => (
              <CheckpointRow
                key={c.id}
                cp={c}
                currency={currency}
                onSave={(p) => patch.mutate({ cpId: c.id, patch: p })}
                onDelete={() => del.mutate(c.id)}
                saving={patch.isPending}
                deleting={del.isPending}
              />
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          className="input-sm w-36"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          aria-label="Date du point de contrôle"
        />
        <input
          type="text"
          inputMode="decimal"
          className="input-sm w-28 text-right"
          placeholder="0.00"
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
          aria-label="Montant attendu"
        />
        <input
          type="text"
          className="input-sm flex-1 min-w-[8rem]"
          placeholder="note (optionnelle)"
          maxLength={200}
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          aria-label="Note"
        />
        <button
          type="button"
          className="btn-sm"
          disabled={!newAmount || create.isPending}
          onClick={() => create.mutate()}
        >
          + ajouter
        </button>
      </div>
      {createError && (
        <div className="mt-1 text-[11px] text-clay-300">{createError}</div>
      )}
    </div>
  );
}

function CheckpointRow({
  cp,
  currency,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  cp: BalanceCheckpoint;
  currency: string;
  onSave: (patch: { expectedAmount?: string; note?: string | null }) => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
}) {
  const [editingAmount, setEditingAmount] = useState(false);
  const [amountDraft, setAmountDraft] = useState(cp.expectedAmount);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(cp.note ?? '');

  const commitAmount = () => {
    if (amountDraft !== cp.expectedAmount && amountDraft.trim() !== '') {
      onSave({ expectedAmount: amountDraft });
    }
    setEditingAmount(false);
  };
  const commitNote = () => {
    const next = noteDraft.trim();
    const current = cp.note ?? '';
    if (next !== current) onSave({ note: next.length === 0 ? null : next });
    setEditingNote(false);
  };

  return (
    <tr className="border-t border-ink-800/60">
      <td className="py-1 text-ink-400">{cp.checkpointDate}</td>
      <td className="py-1 text-right text-ink-200 private">
        {editingAmount ? (
          <input
            className="input-sm w-24 text-right"
            autoFocus
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            onBlur={commitAmount}
            onKeyDown={(e) => e.key === 'Enter' && commitAmount()}
          />
        ) : (
          <button className="hover:text-ink-100" onClick={() => setEditingAmount(true)}>
            {formatAmount(cp.expectedAmount, currency)}
          </button>
        )}
      </td>
      <td className="py-1 pl-3 text-ink-500">
        {editingNote ? (
          <input
            className="input-sm w-full"
            autoFocus
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={commitNote}
            onKeyDown={(e) => e.key === 'Enter' && commitNote()}
          />
        ) : (
          <button className="text-left hover:text-ink-200 w-full" onClick={() => setEditingNote(true)}>
            {cp.note ?? <span className="italic text-ink-700">ajouter…</span>}
          </button>
        )}
      </td>
      <td className="py-1 text-right">
        <button
          className="text-ink-600 hover:text-clay-300 transition"
          onClick={onDelete}
          disabled={deleting || saving}
          aria-label="Supprimer"
          title="Supprimer"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
```

Import `formatAmount` at the top of the file if it isn't already imported — check `frontend/src/lib/format.ts` for the correct symbol name (the file uses `formatAmount` per `BalanceChart.tsx` — the existing Accounts.tsx already uses it).

- [ ] **Step 4: TypeScript check**

Run:
```bash
cd frontend && npx tsc -p tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 5: Manual end-to-end verify**

```bash
docker compose up --build
```
Open <http://127.0.0.1:8000>, login, navigate to Comptes.

1. Pick an account card, click `▸ Points de contrôle` → drawer opens, empty-state text visible.
2. Enter a date + amount + optional note, click `+ ajouter` → new row appears in the table.
3. Click the amount cell → inline input, edit, Enter → row updates.
4. Click the note cell → inline input, edit, Enter → note updates.
5. Try to add a second checkpoint on the *same date* → error text appears: `"Un point de contrôle existe déjà à cette date."`
6. Click ✕ → row disappears.
7. Navigate to Dashboard → set the chart scope to that account → the checkpoint diamond appears on the chart with the caption `1 point de contrôle · N drift(s)` matching what you configured.
8. Delete the account itself from Comptes → confirm from the dialog. Verify (psql) that `balance_checkpoints` is empty for that account.

Kill the stack.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Accounts.tsx
git commit -m "$(cat <<'EOF'
feat(accounts): expandable balance-checkpoints drawer per account card

Inline CRUD table (date | attendu | note | delete) plus a persistent
add-row. Cache key matches the Dashboard so mutations refresh the
chart on next visit. Duplicate-date errors surface inline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Docs (README + roadmap)

**Files:**
- Modify: `README.md` (roadmap section + a short paragraph under Dashboard content)
- Modify: `TODO.md` (move "Display point of amount…" from Idées to Fait)

**Interfaces:** none.

- [ ] **Step 1: Add a short paragraph under the API surface / usage**

In `README.md`, add a new short section titled `## Points de contrôle` (or drop it in an existing Dashboard-related section — pick whichever fits the current file's structure). Keep it two or three sentences:

```markdown
## Points de contrôle

Sur chaque compte (onglet **Comptes** → `▸ Points de contrôle`), vous
pouvez enregistrer un solde attendu à une date donnée (typiquement lu
sur un relevé bancaire). Le graphique du dashboard affiche un losange à
cette date; s'il dérive de plus d'un centime du cumul calculé, le
losange devient ambre et une ligne pointillée relie l'attendu au réel —
un signal purement visuel pour repérer une erreur d'import ou de saisie.
```

- [ ] **Step 2: Extend the roadmap**

In `README.md`, under `## Roadmap`, append a new checked line:

```markdown
- [x] Étape 12 — Points de contrôle (réconciliation visuelle par compte)
```

- [ ] **Step 3: Move the TODO entry**

In `TODO.md`, remove the first bullet under `## 🧠 Idées (en vrac)` (the "Display point of amount…" line + its follow-up "I want a point…") and add under `## ✅ Fait`:

```markdown
- Points de contrôle par compte affichés sur le graphique Dashboard (drift vs. cumul calculé, tolérance 1 centime).
```

- [ ] **Step 4: Commit**

```bash
git add README.md TODO.md
git commit -m "$(cat <<'EOF'
docs: document balance checkpoints (roadmap + short section)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

- **Spec coverage:** every section of `2026-07-01-graph-anchor-point-design.md` has a task — data model (Task 1), backend API + tests (Task 2), API client + types (Task 3), chart rendering (Task 4), dashboard wiring (Task 5), accounts drawer (Task 6), docs (Task 7).
- **Type consistency:** the chart's `checkpoints` prop uses `expectedAmount: number` (Task 4); Dashboard converts once via `Number(...)` (Task 5); the API/API-client wrap the DB-native fixed-point string (Tasks 2, 3). No name divergence.
- **Placeholder scan:** no TODOs, no "similar to Task N" hand-waves, no un-defined types. Manual-verify steps are concrete (exact URLs, exact psql commands, exact expected behavior).
- **Deferred tests:** frontend has no test harness — Tasks 4, 5, 6 rely on manual smoke tests. Not ideal, but consistent with the project's current posture.
