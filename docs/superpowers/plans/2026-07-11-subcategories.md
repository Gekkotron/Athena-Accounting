# Sub-categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a coherent 2-level category hierarchy across the classification stack (data model, backend guarantees, Categories UI, and every downstream row-level surface).

**Architecture:** The `categories.parent_id` column already exists and is already respected by the Sankey rollup and the backup export/restore round-trip. This plan (a) tightens the uniqueness index to be per-parent, (b) makes the backend enforce depth cap + kind inheritance + cycle prevention, (c) rolls up parent budgets, (d) adds a shared `formatCategoryPath` helper and threads it through every consumer, (e) re-renders the Categories and Budgets pages with grouped rows, and (f) aggregates the Insights "top mover" ranking at the root.

**Tech Stack:** Postgres + Drizzle ORM + Fastify + Zod on the backend (`backend/`); React 18 + TypeScript + TanStack Query + Vitest + Testing Library on the frontend (`frontend/`). Migrations are plain SQL files under `backend/src/db/migrations/`, applied lexicographically by `backend/src/db/migrate.ts`.

## Global Constraints

- **Depth cap:** 2 levels. A category with a `parent_id` cannot itself become a parent; setting `parent_id` on a row that already has children is a 400.
- **Kind inheritance:** child rows inherit their parent's `kind`. Server-side: any `PUT` that sets/changes `parentId` coerces the row's `kind` to the parent's; a bare-`kind` `PUT` on a row that already has a `parent_id` and would deviate is a 400. Changing a parent's `kind` cascades to all its children in the same DB transaction.
- **Uniqueness:** index scoped to `(user_id, COALESCE(parent_id, 0), name)`. Two `Restaurant` rows under two different parents are legal; two under the same parent (or two at the top level) still 409.
- **Assignment:** any level. A category with children is still assignable to transactions and rules; no cascade from rule-on-parent to children.
- **Row-level display:** `formatCategoryPath` returns `"Parent › Leaf"` (U+203A) for nested categories; plain name for roots or orphans (parent missing from the local map).
- **Budgets:** setting a budget on a parent rolls up `actual = own + descendants`. Leaves stay on single-category `SUM`. Server-side.
- **Delete semantics:** unchanged — existing `ON DELETE SET NULL` on `parent_id` promotes children to top-level.
- **Backup restore:** already links parents in a second pass. New validators must let the two-pass replay succeed (kind coercion is what makes this safe).
- **French UI copy.** Path glyph is `›` (U+203A), not `>`. Warnings use existing tone (`« hérité de X »`, `« s'applique aussi aux N sous-catégories »`).
- **Test commands:**
  - Backend DB-gated: `RUN_DB_TESTS=1 npx vitest run <path>` from `backend/`.
  - Frontend: `npx vitest run <path>` from `frontend/`.
- **v1 non-goals (do not touch):** drag-to-nest, bulk "move N under parent", tree picker in Rules/Transactions modals, rolling up the Category donut / breakdown, rules that cascade parent → children.
- **Commit identity:** `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com` on every commit. Never push (`git push` only on explicit user ask).

---

### Task 1: Migration `0019` — uniqueness index switch

**Files:**
- Create: `backend/src/db/migrations/0019_subcategories.sql`
- Modify: `backend/src/db/schema.ts:144`
- Test: `backend/tests/categories-route.test.ts` (add uniqueness-per-parent case)

**Interfaces:**
- Consumes: existing `categories` table (nothing new).
- Produces: SQL guarantee that duplicate names are allowed across parents. The index rename is what unlocks Task 5's parent-selector UI.

- [ ] **Step 1: Write the failing test (uniqueness scoped to parent)**

Add this `it(...)` block inside the existing `describe.skipIf(!RUN)('/api/categories', () => { ... })` in `backend/tests/categories-route.test.ts`, after the "rejects a duplicate name with 409" case:

```ts
  it('accepts the same name under two different parents', async () => {
    const parentA = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Loisirs', kind: 'expense' },
    });
    const parentB = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Voyages', kind: 'expense' },
    });
    expect(parentA.statusCode).toBe(201);
    expect(parentB.statusCode).toBe(201);

    const childA = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Restaurant', kind: 'expense', parentId: parentA.json().category.id },
    });
    const childB = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Restaurant', kind: 'expense', parentId: parentB.json().category.id },
    });
    expect(childA.statusCode).toBe(201);
    expect(childB.statusCode).toBe(201);
  });

  it('still rejects a duplicate name under the same parent', async () => {
    const parent = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Courses', kind: 'expense' },
    });
    await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Alimentation', kind: 'expense', parentId: parent.json().category.id },
    });
    const dup = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Alimentation', kind: 'expense', parentId: parent.json().category.id },
    });
    expect(dup.statusCode).toBe(409);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`:

```bash
RUN_DB_TESTS=1 npx vitest run tests/categories-route.test.ts
```

Expected: both new cases fail. The first fails with `409` because the current index `categories_user_name_idx` on `(user_id, name)` blocks the second `Restaurant`. The second still passes for the wrong reason (same-parent dup would 409 today too, but only because the parent scope is not enforced) — leave both in the suite; both must be green after Step 4.

- [ ] **Step 3: Write the migration and update the Drizzle schema**

Create `backend/src/db/migrations/0019_subcategories.sql`:

```sql
-- 2-level category hierarchy. `parent_id` already exists (self-FK,
-- ON DELETE SET NULL). This migration scopes the uniqueness of category
-- names to (user_id, parent_id, name) instead of (user_id, name), so the
-- same leaf name (e.g. "Restaurant") can live under two different parents.
--
-- COALESCE(parent_id, 0) puts top-level rows into their own bucket, which
-- preserves the pre-existing "no two same-named top-level categories"
-- constraint. No data backfill needed: all existing rows have
-- parent_id = NULL, so the coalesced bucket for them is 0 and any
-- duplicates would already have been rejected by the old index.
DROP INDEX IF EXISTS categories_user_name_idx;
CREATE UNIQUE INDEX categories_user_parent_name_idx
  ON categories (user_id, COALESCE(parent_id, 0), name);
```

Modify `backend/src/db/schema.ts` line 144 (inside the `categories` table `(t) => ({ ... })` block):

```ts
    // Before:
    // uqUserName: uniqueIndex('categories_user_name_idx').on(t.userId, t.name),
    // After:
    uqUserParentName: uniqueIndex('categories_user_parent_name_idx').on(
      t.userId,
      sql`COALESCE(${t.parentId}, 0)`,
      t.name,
    ),
```

Add the `sql` import at the top of `schema.ts` if it's not already there:

```ts
import { sql } from 'drizzle-orm';
```

(Drizzle allows raw SQL expressions inside `uniqueIndex().on(...)` — this matches how a coalesced column would be indexed by Postgres and mirrors the migration.)

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`:

```bash
RUN_DB_TESTS=1 npx vitest run tests/categories-route.test.ts
```

Expected: the two new cases pass, and every pre-existing case in the file still passes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0019_subcategories.sql backend/src/db/schema.ts backend/tests/categories-route.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(categories): scope name uniqueness to (user, parent, name)

Migration 0019 replaces categories_user_name_idx with categories_user_parent_name_idx on (user_id, COALESCE(parent_id, 0), name), so the same leaf name can live under two different parents. Existing rows all have parent_id = NULL and are unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Backend validation on `POST` / `PUT /api/categories`

**Files:**
- Modify: `backend/src/http/routes/categories.ts`
- Test: `backend/tests/categories-route.test.ts` (extend)

**Interfaces:**
- Consumes: `categories` table (with the index switch from Task 1).
- Produces: 4 new 400 error codes and one silent kind-coercion behavior that every downstream API caller — UI, backup restore, MCP — can rely on. The frontend Categories page (Task 5) uses these guarantees to hide the kind picker for children and to gray out disallowed parent selects.

Detailed API contract:

- `POST /api/categories` with `parentId`:
  - `parent not found` (400) — parent id doesn't exist or belongs to another user.
  - `only 2 levels supported` (400) — the parent already has a `parent_id`.
  - kind on the created row is coerced to the parent's kind (silent — no error even if the client sent a different kind).
- `PUT /api/categories/:id`:
  - If the request touches `parentId` (setting or changing it):
    - Same `parent not found` / `only 2 levels supported` errors.
    - `cannot nest a category that has children` (400) — this row already has children (would create a 3-level chain).
    - `cannot self-parent` (400) — `parentId === id`.
    - Kind on the row is coerced to the new parent's kind in the same DB transaction (protects backup restore's two-pass).
  - If `parentId` is not in the request and `kind` changes:
    - On a **parent** (a row with children): the new `kind` cascades to every child in the same DB transaction. No error.
    - On a **child** (a row with `parent_id IS NOT NULL`): if the new `kind` differs from the parent's, return 400 `child kind is inherited from parent`. If it matches the parent's already, allow (no-op).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/categories-route.test.ts` inside the same `describe.skipIf(!RUN)` block:

```ts
  it('POST rejects a parent that does not exist', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Enfant', kind: 'expense', parentId: 999999 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('parent not found');
  });

  it('POST rejects a grandchild (only 2 levels)', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Racine', kind: 'expense' },
    });
    const c = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Enfant', kind: 'expense', parentId: p.json().category.id },
    });
    const gc = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'PetitEnfant', kind: 'expense', parentId: c.json().category.id },
    });
    expect(gc.statusCode).toBe(400);
    expect(gc.json().error).toBe('only 2 levels supported');
  });

  it('POST coerces child kind to the parent kind', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Depenses', kind: 'expense' },
    });
    const c = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Loyer', kind: 'income', parentId: p.json().category.id },
    });
    expect(c.statusCode).toBe(201);
    expect(c.json().category.kind).toBe('expense');
  });

  it('PUT rejects self-parent', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Solo', kind: 'expense' },
    });
    const id = r.json().category.id;
    const res = await app.inject({
      method: 'PUT', url: `/api/categories/${id}`, headers: { cookie },
      payload: { parentId: id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('cannot self-parent');
  });

  it('PUT rejects nesting a category that has children', async () => {
    const a = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'A', kind: 'expense' },
    });
    const b = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'B', kind: 'expense' },
    });
    await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Bchild', kind: 'expense', parentId: b.json().category.id },
    });
    // now try to nest B under A — but B already has a child.
    const res = await app.inject({
      method: 'PUT', url: `/api/categories/${b.json().category.id}`, headers: { cookie },
      payload: { parentId: a.json().category.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('cannot nest a category that has children');
  });

  it('PUT coerces kind when parentId is set (protects backup restore)', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Salaires', kind: 'income' },
    });
    const orphan = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'PrimeAnnuelle', kind: 'expense' },
    });
    const res = await app.inject({
      method: 'PUT', url: `/api/categories/${orphan.json().category.id}`, headers: { cookie },
      payload: { parentId: p.json().category.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().category.kind).toBe('income');
    expect(res.json().category.parentId).toBe(p.json().category.id);
  });

  it('PUT cascades kind change on a parent to its children', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Groupe', kind: 'expense' },
    });
    const c1 = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Enf1', kind: 'expense', parentId: p.json().category.id },
    });
    const c2 = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Enf2', kind: 'expense', parentId: p.json().category.id },
    });
    const res = await app.inject({
      method: 'PUT', url: `/api/categories/${p.json().category.id}`, headers: { cookie },
      payload: { kind: 'neutral' },
    });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/categories', headers: { cookie } });
    const byId = new Map<number, { kind: string }>(list.json().categories.map((c: { id: number; kind: string }) => [c.id, c]));
    expect(byId.get(c1.json().category.id)!.kind).toBe('neutral');
    expect(byId.get(c2.json().category.id)!.kind).toBe('neutral');
  });

  it('PUT rejects a bare kind change on a child that would deviate', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Depenses2', kind: 'expense' },
    });
    const c = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Loyer2', kind: 'expense', parentId: p.json().category.id },
    });
    const res = await app.inject({
      method: 'PUT', url: `/api/categories/${c.json().category.id}`, headers: { cookie },
      payload: { kind: 'income' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('child kind is inherited from parent');
  });

  it('DELETE parent promotes children to top-level', async () => {
    const p = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'DoomedParent', kind: 'expense' },
    });
    const c = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Survivor', kind: 'expense', parentId: p.json().category.id },
    });
    const del = await app.inject({
      method: 'DELETE', url: `/api/categories/${p.json().category.id}`, headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/categories', headers: { cookie } });
    const survivor = list.json().categories.find((x: { id: number }) => x.id === c.json().category.id);
    expect(survivor.parentId).toBe(null);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`:

```bash
RUN_DB_TESTS=1 npx vitest run tests/categories-route.test.ts
```

Expected: all new cases fail. Route currently accepts any parentId (including non-existent, grandparent chains, self, and cycles) without validation and does no cascade/coercion.

- [ ] **Step 3: Rewrite the route handlers**

Replace the two mutation handlers in `backend/src/http/routes/categories.ts` (the `app.post('/api/categories', ...)` and `app.put('/api/categories/:id', ...)` blocks). Also update the imports at the top of the file.

Imports at the top (change the existing drizzle-orm import line):

```ts
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
```

Replace the `POST` handler with:

```ts
  app.post('/api/categories', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    let payload = parsed.data;
    if (payload.parentId != null) {
      const [parent] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, payload.parentId), eq(categories.userId, uid)));
      if (!parent) return reply.code(400).send({ error: 'parent not found' });
      if (parent.parentId != null) {
        return reply.code(400).send({ error: 'only 2 levels supported' });
      }
      payload = { ...payload, kind: parent.kind };
    }
    try {
      const [created] = await db.insert(categories).values({ ...payload, userId: uid }).returning();
      return reply.code(201).send({ category: created });
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'category name already exists' });
      }
      throw err;
    }
  });
```

Replace the `PUT` handler with:

```ts
  app.put('/api/categories/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }

    const [current] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, uid)));
    if (!current) return reply.code(404).send({ error: 'not found' });

    const touchesParent = Object.prototype.hasOwnProperty.call(parsed.data, 'parentId');
    let payload = { ...parsed.data };

    if (touchesParent) {
      const nextParentId = parsed.data.parentId ?? null;
      if (nextParentId !== null) {
        if (nextParentId === id) {
          return reply.code(400).send({ error: 'cannot self-parent' });
        }
        // Does this row already have children? If so, nesting it would create a 3-level chain (or cycle).
        const [child] = await db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.parentId, id), eq(categories.userId, uid)))
          .limit(1);
        if (child) {
          return reply
            .code(400)
            .send({ error: 'cannot nest a category that has children' });
        }
        const [parent] = await db
          .select()
          .from(categories)
          .where(and(eq(categories.id, nextParentId), eq(categories.userId, uid)));
        if (!parent) return reply.code(400).send({ error: 'parent not found' });
        if (parent.parentId != null) {
          return reply.code(400).send({ error: 'only 2 levels supported' });
        }
        payload.kind = parent.kind;
      }
    } else if (parsed.data.kind && current.parentId != null) {
      // Bare kind change on a child. Allowed only if it stays equal to the parent's kind.
      const [parent] = await db
        .select({ kind: categories.kind })
        .from(categories)
        .where(and(eq(categories.id, current.parentId), eq(categories.userId, uid)));
      if (parent && parsed.data.kind !== parent.kind) {
        return reply
          .code(400)
          .send({ error: 'child kind is inherited from parent' });
      }
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(categories)
          .set(payload)
          .where(and(eq(categories.id, id), eq(categories.userId, uid)))
          .returning();
        // If we changed kind on a row that itself has children, cascade to them.
        if (row && payload.kind && current.parentId == null) {
          await tx
            .update(categories)
            .set({ kind: payload.kind })
            .where(
              and(
                eq(categories.userId, uid),
                eq(categories.parentId, id),
                ne(categories.kind, payload.kind),
              ),
            );
        }
        return row;
      });
      if (!updated) return reply.code(404).send({ error: 'not found' });
      return { category: updated };
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'category name already exists' });
      }
      throw err;
    }
  });
```

Note: the cascade branch guards on `current.parentId == null` because only top-level rows can have children (depth cap = 2). `inArray` and `isNotNull` are imported for parity with the surrounding codebase but only `ne` + `eq` + `and` are used above; unused imports will trip TS lint — drop `inArray` / `isNotNull` from the import if the linter complains.

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`:

```bash
RUN_DB_TESTS=1 npx vitest run tests/categories-route.test.ts
```

Expected: every test in the file passes (the 8 new cases from Step 1 plus every pre-existing case).

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/categories.ts backend/tests/categories-route.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(categories): enforce hierarchy invariants on POST/PUT

Adds server-side validation for the 2-level cap, kind inheritance (coerce on parentId set, cascade on parent kind change, reject bare deviating kind edit on a child), self-parent, and would-cause-3-level nesting. Guarantees any future direct-API writer (backup restore, MCP) can't create garbage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Budget report rollup for parent categories

**Files:**
- Modify: `backend/src/http/routes/reports.ts` (the `/api/reports/budget` handler, roughly lines 219-285)
- Test: `backend/tests/reports-route.test.ts` (extend)

**Interfaces:**
- Consumes: `categories.parent_id`, `category_budgets`, `tx_effective` CTE.
- Produces: `BudgetReport.rows[].spent` on a parent row is now `own + descendants`; the API shape (`{ month, rows, totals }`) is unchanged. The frontend Budgets page (Task 7) does not need any new field.

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe.skipIf(!RUN)('reports routes', ...)` (or the closest matching `describe` block) in `backend/tests/reports-route.test.ts`. Place after the existing budget test if there is one, else after the categories report tests:

```ts
  it('GET /api/reports/budget rolls up child spending into a parent budget', async () => {
    // Create Courses (parent) + Alimentation (child) + a rogue expense on each.
    const parent = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Courses', kind: 'expense' },
    });
    const child = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Alimentation', kind: 'expense', parentId: parent.json().category.id },
    });

    // The test file already has a helper for creating an account + posting transactions;
    // use it to post one transaction under the parent (-50) and one under the child (-30)
    // in the target month (e.g. 2026-06-15).
    const parentId = parent.json().category.id;
    const childId = child.json().category.id;
    await postTransaction({ amount: '-50.00', date: '2026-06-15', categoryId: parentId });
    await postTransaction({ amount: '-30.00', date: '2026-06-15', categoryId: childId });

    await app.inject({
      method: 'POST', url: '/api/budgets', headers: { cookie },
      payload: { categoryId: parentId, monthlyLimit: '100.00' },
    });

    const res = await app.inject({
      method: 'GET', url: '/api/reports/budget?month=2026-06', headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const row = res.json().rows.find((r: { categoryId: number }) => r.categoryId === parentId);
    expect(row.spent).toBe('80.00');
    expect(row.over).toBe(false);
    expect(row.pct).toBe(80);
  });
```

If `postTransaction` / the shared account fixture doesn't exist in this file, adapt to the same pattern the other tests in the file already use for inserting transactions.

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`:

```bash
RUN_DB_TESTS=1 npx vitest run tests/reports-route.test.ts
```

Expected: fails with `expected '50.00' to be '80.00'` — the current query only sums transactions directly on the parent.

- [ ] **Step 3: Modify the budget SQL to include descendants**

In `backend/src/http/routes/reports.ts`, replace the `LEFT JOIN tx_effective e ON ...` block in the `/api/reports/budget` handler with:

```ts
      LEFT JOIN tx_effective e
        ON (
          e.category_id = b.category_id
          OR e.category_id IN (
            SELECT cc.id FROM categories cc
            WHERE cc.parent_id = b.category_id AND cc.user_id = ${uid}
          )
        )
       AND e.user_id = ${uid}
       AND e.transfer_group_id IS NULL
       AND to_char(date_trunc('month', e.date::timestamp), 'YYYY-MM') = ${month}
```

Depth cap is 2, so a single-level `IN (SELECT id FROM categories WHERE parent_id = b.category_id)` covers every descendant. If a child of a child ever became possible, this query would need `WITH RECURSIVE` — but Task 2 makes 3-level chains a 400, so this stays correct.

Update the code comment above the handler (currently mentions "Reuses the tx_effective CTE"): append `. Parent budgets roll up own + direct children (depth cap = 2).`

- [ ] **Step 4: Run test to verify it passes**

Run from `backend/`:

```bash
RUN_DB_TESTS=1 npx vitest run tests/reports-route.test.ts
```

Expected: the new case passes. Every pre-existing test still passes (a leaf-only budget still returns the same `spent` as before because a leaf has no descendants).

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/routes/reports.ts backend/tests/reports-route.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(reports): roll up child spending into parent budgets

/api/reports/budget now sums descendant transactions into a parent budget's actual, so a budget on Courses covers both Courses and Alimentation/Ménage under it. Leaves keep single-category SUM. Depth cap = 2 keeps the sub-select O(1).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Shared `formatCategoryPath` helper

**Files:**
- Modify: `frontend/src/lib/categories.ts`
- Create: `frontend/src/lib/__tests__/categories.test.ts`

**Interfaces:**
- Consumes: `Category` from `../api/types`.
- Produces:
  ```ts
  export function formatCategoryPath(
    cat: Category,
    byId: Map<number, Category>,
  ): string;
  ```
  Returns `"Parent › Leaf"` for a child, plain `cat.name` for a root or an orphan (parent missing from the map).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/__tests__/categories.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatCategoryPath } from '../categories';
import type { Category } from '../../api/types';

function cat(id: number, name: string, parentId: number | null = null): Category {
  return { id, name, kind: 'expense', color: null, parentId, isDefault: false, isInternalTransfer: false };
}

describe('formatCategoryPath', () => {
  const parent = cat(1, 'Courses');
  const child = cat(2, 'Alimentation', 1);
  const byId = new Map<number, Category>([[1, parent], [2, child]]);

  it('returns the plain name for a top-level category', () => {
    expect(formatCategoryPath(parent, byId)).toBe('Courses');
  });

  it("joins parent name and leaf name with '›'", () => {
    expect(formatCategoryPath(child, byId)).toBe('Courses › Alimentation');
  });

  it('falls back to the plain name when the parent is missing from the map', () => {
    const orphanMap = new Map<number, Category>([[2, child]]);
    expect(formatCategoryPath(child, orphanMap)).toBe('Alimentation');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`:

```bash
npx vitest run src/lib/__tests__/categories.test.ts
```

Expected: fails with `formatCategoryPath is not a function` or `not exported from '../categories'`.

- [ ] **Step 3: Add the helper to `frontend/src/lib/categories.ts`**

Open `frontend/src/lib/categories.ts` and append (keep the existing `KIND_LABEL` / `kindBadgeClass` exports at the top):

```ts
import type { Category } from '../api/types';

// Renders a category name with its parent path when nested:
//   root      -> "Courses"
//   nested    -> "Courses › Alimentation"
//   orphaned  -> "Alimentation"  (parent missing from the local map)
// The '›' glyph is U+203A; the same used in the design mocks.
export function formatCategoryPath(
  cat: Category,
  byId: Map<number, Category>,
): string {
  if (cat.parentId == null) return cat.name;
  const parent = byId.get(cat.parentId);
  return parent ? `${parent.name} › ${cat.name}` : cat.name;
}
```

Only add the `import type { Category }` line if not already imported at the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run from `frontend/`:

```bash
npx vitest run src/lib/__tests__/categories.test.ts
```

Expected: all 3 cases pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/categories.ts frontend/src/lib/__tests__/categories.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(categories): add formatCategoryPath helper

Renders a category with its parent path when nested ("Courses › Alimentation"), plain name at top level or when the parent is missing from the local map. Threaded into every row-level consumer in the next tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Categories page — grouped rows + parent selectors

**Files:**
- Modify: `frontend/src/pages/Rules/Categories.tsx`
- Test: `frontend/src/pages/Rules/__tests__/Categories.test.tsx`

**Interfaces:**
- Consumes: `formatCategoryPath` (Task 4) is *not* needed here — this page shows names in isolation, in grouped rows.
- Produces: no new module exports; this task is UI-only.

The rewrite is substantial. Break rendering into two small local helpers inside the file: `groupCategories(cats)` returning `{ roots, childrenByParent }`, and a `renderCategoryRow(c, depth)` that returns the `<tr>` (called twice — once per root, once per child, with different `depth` values).

- [ ] **Step 1: Write the failing tests**

Extend `frontend/src/pages/Rules/__tests__/Categories.test.tsx`. Where the file currently mocks `/api/categories`, extend the mock response to include a nested pair. Add these cases (add missing imports at the top of the test file if needed):

```ts
  it('renders a child row indented beneath its parent', async () => {
    // In the mock's /api/categories response, add:
    //   { id: 20, name: 'Courses', kind: 'expense', ..., parentId: null }
    //   { id: 21, name: 'Alimentation', kind: 'expense', ..., parentId: 20 }
    render(<Categories />, { wrapper: withProviders });
    const parent = await screen.findByText('Courses');
    const child = await screen.findByText('Alimentation');
    const parentRow = parent.closest('tr')!;
    const childRow = child.closest('tr')!;
    // Child row appears immediately after its parent row.
    expect(parentRow.nextElementSibling).toBe(childRow);
    // Child row has a data-depth attribute we set for indentation styling.
    expect(childRow.getAttribute('data-depth')).toBe('1');
  });

  it('disables the kind picker on a child row', async () => {
    render(<Categories />, { wrapper: withProviders });
    const child = await screen.findByText('Alimentation');
    const childRow = child.closest('tr')!;
    const kindSelect = within(childRow).getByRole('combobox', { name: /type/i });
    expect(kindSelect).toBeDisabled();
    expect(kindSelect).toHaveAttribute('title', expect.stringContaining('hérité'));
  });

  it('disables the parent selector on a category that already has children', async () => {
    render(<Categories />, { wrapper: withProviders });
    const parent = await screen.findByText('Courses');
    const parentRow = parent.closest('tr')!;
    const parentSelect = within(parentRow).getByRole('combobox', { name: /parent/i });
    expect(parentSelect).toBeDisabled();
  });

  it('locks kind in the create form when a parent is selected', async () => {
    render(<Categories />, { wrapper: withProviders });
    const parentInCreate = await screen.findByRole('combobox', { name: /parent \(optionnel\)/i });
    const kindInCreate = screen.getByRole('combobox', { name: /^type$/i });
    fireEvent.change(parentInCreate, { target: { value: '20' } }); // Courses id
    expect(kindInCreate).toBeDisabled();
    expect(kindInCreate).toHaveValue('expense');
  });

  it('appends the "sous-catégories deviendront racines" line to the delete confirm for a parent', async () => {
    render(<Categories />, { wrapper: withProviders });
    const parent = await screen.findByText('Courses');
    const parentRow = parent.closest('tr')!;
    fireEvent.click(within(parentRow).getByText('supprimer'));
    expect(
      await screen.findByText(/sous-catégories deviendront des catégories racine/i),
    ).toBeInTheDocument();
  });
```

The test file already imports `render`, `screen`, `fireEvent`, `within`; add whatever is missing.

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`:

```bash
npx vitest run src/pages/Rules/__tests__/Categories.test.tsx
```

Expected: every new case fails — the current page renders a flat table with no parent selector, no kind lock in the create form, and no extra line in the delete dialog.

- [ ] **Step 3: Rewrite `Categories.tsx`**

Replace the body of `frontend/src/pages/Rules/Categories.tsx` with the version below. Structure:

1. **State**: add `parentIdInCreate: number | null` alongside the existing `name` / `kind` / `color` state.
2. **Grouping**: derive `{ roots, childrenByParent }` from `cats` right after the `cats = catQ.data?.categories ?? []` line.
3. **Create form**: add a `Parent (optionnel)` `<select>` between the `Nom` and `Type` fields. When the selected parent id is non-null, resolve its kind, force the `Kind` select value + `disabled`.
4. **Table body**: render `roots.flatMap(r => [<row r depth=0 />, ...(childrenByParent.get(r.id) ?? []).map(c => <row c depth=1 />)])`.
5. **Row helper** — takes `(c: Category, depth: 0 | 1)` and returns a `<tr key data-depth={depth}>`. On `depth === 1`, prepend `pl-8` on the Name cell for the indent, disable the Kind picker, and add its "hérité de {parent}" `title`. On `depth === 0` where the row has children, disable the Parent picker.
6. **Kind cascade warning**: when a parent-row Kind select fires and the row has children, use `window.confirm(« Changer aussi le type des N sous-catégories ? »)` before the mutation. Cancel → revert the select to `c.kind`.
7. **Delete confirm**: when the target row has children, pass a `description` prop that appends the extra line.
8. **Parent select** (per row): options built as `[{ id: null, label: '—' }, ...roots.filter(r => r.id !== c.id && (childrenByParent.get(r.id) ?? []).length === 0)]`. The current parent (if any) must also appear even if it now has other children, so the row can still show its own state.

Here is the full replacement file. Copy this in verbatim:

```tsx
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Category, CategoryKind, CategoryReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';
import { KIND_LABEL, kindBadgeClass } from '../../lib/categories';
import { CategoryBreakdown } from '../../components/CategoryBreakdown';
import { ConfirmDialog } from '../../components/ConfirmDialog';

function groupCategories(cats: Category[]): {
  roots: Category[];
  childrenByParent: Map<number, Category[]>;
} {
  const roots: Category[] = [];
  const childrenByParent = new Map<number, Category[]>();
  for (const c of cats) {
    if (c.parentId == null) roots.push(c);
    else {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return { roots, childrenByParent };
}

export function Categories() {
  const qc = useQueryClient();
  const catQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });
  const reportQ = useQuery({
    queryKey: ['reports', 'categories'],
    queryFn: () => api<{ rows: CategoryReportRow[] }>('/api/reports/categories'),
  });

  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [color, setColor] = useState('');
  const [parentIdInCreate, setParentIdInCreate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: {
      name: string;
      kind: CategoryKind;
      color: string | null;
      parentId: number | null;
    }) => api<{ category: Category }>('/api/categories', { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setName('');
      setColor('');
      setParentIdInCreate(null);
    },
    onError: (err: ApiError) => setError(err.message),
  });
  const updateCategory = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Category> }) =>
      api(`/api/categories/${id}`, { method: 'PUT', json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (err: ApiError) => setError(err.message),
  });
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['rules'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      setConfirmDelete(null);
      setDeleteError(null);
    },
    onError: (err: ApiError) => setDeleteError(err.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate({
      name: name.trim(),
      kind,
      color: color || null,
      parentId: parentIdInCreate,
    });
  };

  const cats = catQ.data?.categories ?? [];
  const report = reportQ.data?.rows ?? [];
  const { roots, childrenByParent } = useMemo(() => groupCategories(cats), [cats]);
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  const ownTotalsByCat = new Map<number, number>();
  for (const r of report) {
    if (r.category_id == null) continue;
    const prev = ownTotalsByCat.get(r.category_id) ?? 0;
    ownTotalsByCat.set(r.category_id, prev + Number(r.total));
  }
  const rolledUpTotal = (c: Category): number => {
    let sum = ownTotalsByCat.get(c.id) ?? 0;
    for (const ch of childrenByParent.get(c.id) ?? []) {
      sum += ownTotalsByCat.get(ch.id) ?? 0;
    }
    return sum;
  };

  const parentInCreate = parentIdInCreate != null ? byId.get(parentIdInCreate) : null;
  const effectiveCreateKind = parentInCreate ? parentInCreate.kind : kind;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title">Catégories</h1>
        <p className="page-subtitle max-w-2xl">
          Le <span className="display-italic">« kind »</span> alimente le garde-fou de signe :
          une catégorie « Revenu » ne s'applique jamais à un montant négatif. Les sous-catégories
          héritent du type de leur parent.
        </p>
      </div>

      <section className="surface p-5 md:p-6">
        <div className="section-rule mb-4">Répartition par catégorie</div>
        <CategoryBreakdown defaultRange="3m" />
      </section>

      <form onSubmit={submit} className="surface p-4 md:p-5 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label mb-1.5 block" htmlFor="cat-create-name">Nom</label>
          <input
            id="cat-create-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="w-full sm:w-56">
          <label className="label mb-1.5 block" htmlFor="cat-create-parent">
            Parent (optionnel)
          </label>
          <select
            id="cat-create-parent"
            className="input"
            value={parentIdInCreate ?? ''}
            onChange={(e) => setParentIdInCreate(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">—</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div className="w-full sm:w-40">
          <label className="label mb-1.5 block" htmlFor="cat-create-kind">Type</label>
          <select
            id="cat-create-kind"
            className="input"
            value={effectiveCreateKind}
            disabled={parentInCreate != null}
            title={
              parentInCreate
                ? `Type hérité de « ${parentInCreate.name} »`
                : undefined
            }
            onChange={(e) => setKind(e.target.value as CategoryKind)}
          >
            <option value="expense">Dépense</option>
            <option value="income">Revenu</option>
            <option value="neutral">Neutre</option>
          </select>
        </div>
        <div className="w-full sm:w-32">
          <label className="label mb-1.5 block" htmlFor="cat-create-color">Couleur</label>
          <input
            id="cat-create-color"
            className="input font-mono"
            value={color}
            placeholder="#7dd3c0"
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <button className="btn-primary" disabled={create.isPending}>Ajouter</button>
        {error && <div className="text-sm text-clay-300 w-full">{error}</div>}
      </form>

      <div className="surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-4 py-3 label font-normal">Nom</th>
                <th className="px-4 py-3 label font-normal">Type</th>
                <th className="px-4 py-3 label font-normal hidden lg:table-cell">Parent</th>
                <th
                  className="px-4 py-3 label font-normal hidden md:table-cell text-center"
                  title="Exclut la catégorie des moyennes mensuelles (dépenses/revenus). Utile pour marquer un mouvement interne — épargne, transfert entre comptes — sans passer par la détection automatique."
                >
                  Interne
                </th>
                <th className="px-4 py-3 label font-normal hidden sm:table-cell">Couleur</th>
                <th className="px-4 py-3 label font-normal text-right">Total (période chargée)</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {roots.flatMap((r) => {
                const children = childrenByParent.get(r.id) ?? [];
                return [
                  <CategoryTableRow
                    key={`root-${r.id}`}
                    c={r}
                    depth={0}
                    total={rolledUpTotal(r)}
                    hasChildren={children.length > 0}
                    parent={null}
                    roots={roots}
                    childrenByParent={childrenByParent}
                    updateCategory={updateCategory}
                    onDelete={() => { setDeleteError(null); setConfirmDelete(r); }}
                  />,
                  ...children.map((ch) => (
                    <CategoryTableRow
                      key={`child-${ch.id}`}
                      c={ch}
                      depth={1}
                      total={ownTotalsByCat.get(ch.id) ?? 0}
                      hasChildren={false}
                      parent={r}
                      roots={roots}
                      childrenByParent={childrenByParent}
                      updateCategory={updateCategory}
                      onDelete={() => { setDeleteError(null); setConfirmDelete(ch); }}
                    />
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete ? `Supprimer « ${confirmDelete.name} » ?` : ''}
        description={
          <>
            Les règles pointant vers cette catégorie seront aussi supprimées (cascade).
            Les transactions qui y étaient assignées passeront en{' '}
            <span className="display-italic">sans catégorie</span> — vous pourrez les
            retrouver via l'onglet « Tri ».
            {confirmDelete && (childrenByParent.get(confirmDelete.id) ?? []).length > 0 && (
              <div className="mt-2 text-ink-300">
                Ses {childrenByParent.get(confirmDelete.id)!.length} sous-catégories
                deviendront des catégories racine.
              </div>
            )}
          </>
        }
        confirmLabel="Supprimer la catégorie"
        destructive
        busy={del.isPending}
        error={deleteError}
        onConfirm={() => confirmDelete && del.mutate(confirmDelete.id)}
        onCancel={() => {
          setConfirmDelete(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}

type UpdateMutation = ReturnType<typeof useMutation<
  unknown, ApiError, { id: number; patch: Partial<Category> }
>>;

function CategoryTableRow(props: {
  c: Category;
  depth: 0 | 1;
  total: number;
  hasChildren: boolean;
  parent: Category | null;
  roots: Category[];
  childrenByParent: Map<number, Category[]>;
  updateCategory: UpdateMutation;
  onDelete: () => void;
}): JSX.Element {
  const { c, depth, total, hasChildren, parent, roots, childrenByParent, updateCategory, onDelete } = props;

  const parentOptions = roots.filter(
    (r) => r.id !== c.id && (childrenByParent.get(r.id)?.length ?? 0) === 0,
  );
  // Ensure the current parent is always visible in the dropdown (it might have gained other children since).
  if (parent && !parentOptions.some((r) => r.id === parent.id)) {
    parentOptions.push(parent);
  }

  const kindDisabled = depth === 1;
  const parentDisabled = depth === 0 && hasChildren;

  return (
    <tr
      data-depth={depth}
      className={
        `border-b border-ink-800/40 last:border-0 hover:bg-ink-850/40 transition ${depth === 1 ? 'bg-ink-900/20' : ''}`
      }
    >
      <td className={`px-4 py-2.5 ${depth === 1 ? 'pl-10' : ''}`}>
        <div className="flex items-center gap-2">
          {c.color && (
            <span
              className="h-2 w-2 rounded-full border border-ink-700 shrink-0"
              style={{ backgroundColor: c.color }}
            />
          )}
          <input
            defaultValue={c.name}
            key={`name-${c.id}-${c.name}`}
            className="input-sm flex-1 min-w-0"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== c.name) {
                updateCategory.mutate({ id: c.id, patch: { name: v } });
              } else if (!v) {
                e.target.value = c.name;
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') (e.target as HTMLInputElement).value = c.name;
            }}
          />
          {c.isDefault && <span className="badge ml-1 shrink-0">défaut</span>}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={kindBadgeClass(c.kind)}>{KIND_LABEL[c.kind]}</span>
          <select
            className="input-sm"
            value={c.kind}
            disabled={kindDisabled}
            aria-label="Type"
            title={
              kindDisabled && parent
                ? `Type hérité de « ${parent.name} »`
                : undefined
            }
            onChange={(e) => {
              const nextKind = e.target.value as CategoryKind;
              const children = childrenByParent.get(c.id) ?? [];
              if (children.length > 0) {
                const confirmed = window.confirm(
                  `Changer aussi le type des ${children.length} sous-catégories ?`,
                );
                if (!confirmed) {
                  e.target.value = c.kind;
                  return;
                }
              }
              updateCategory.mutate({ id: c.id, patch: { kind: nextKind } });
            }}
          >
            <option value="expense">Dépense</option>
            <option value="income">Revenu</option>
            <option value="neutral">Neutre</option>
          </select>
        </div>
      </td>
      <td className="px-4 py-2.5 hidden lg:table-cell">
        <select
          className="input-sm"
          value={c.parentId ?? ''}
          disabled={parentDisabled}
          aria-label="Parent"
          title={
            parentDisabled
              ? 'Cette catégorie a des sous-catégories — les 2 niveaux sont la limite.'
              : undefined
          }
          onChange={(e) => {
            const next = e.target.value ? Number(e.target.value) : null;
            updateCategory.mutate({ id: c.id, patch: { parentId: next } });
          }}
        >
          <option value="">—</option>
          {parentOptions.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5 hidden md:table-cell text-center">
        <input
          type="checkbox"
          className="accent-sage-300 align-middle"
          checked={c.isInternalTransfer}
          aria-label={`Marquer « ${c.name} » comme mouvement interne`}
          onChange={(e) =>
            updateCategory.mutate({
              id: c.id,
              patch: { isInternalTransfer: e.target.checked },
            })
          }
        />
      </td>
      <td className="px-4 py-2.5 hidden sm:table-cell">
        <input
          type="text"
          defaultValue={c.color ?? ''}
          key={`color-${c.id}-${c.color ?? ''}`}
          placeholder="#7dd3c0"
          className="input-sm font-mono w-28"
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (raw === '') {
              if (c.color !== null) {
                updateCategory.mutate({ id: c.id, patch: { color: null } });
              }
            } else if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(raw)) {
              if (raw !== c.color) {
                updateCategory.mutate({ id: c.id, patch: { color: raw } });
              }
            } else {
              e.target.value = c.color ?? '';
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') (e.target as HTMLInputElement).value = c.color ?? '';
          }}
        />
      </td>
      <td
        className={`px-4 py-2.5 text-right font-mono tabular-nums ${
          total < 0 ? 'text-clay-300' : total > 0 ? 'text-sage-300' : 'text-ink-500'
        }`}
      >
        {formatAmount(total)}
      </td>
      <td className="px-4 py-2.5 text-right">
        {!c.isDefault && (
          <button
            className="text-[11px] text-ink-500 hover:text-clay-300 transition"
            onClick={onDelete}
          >
            supprimer
          </button>
        )}
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `frontend/`:

```bash
npx vitest run src/pages/Rules/__tests__/Categories.test.tsx
```

Expected: every case passes (5 new + all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Rules/Categories.tsx frontend/src/pages/Rules/__tests__/Categories.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(categories): grouped rows + parent selector on Categories page

Children render indented under their parent. Kind picker disabled on children (inherited); parent picker disabled on a category that already has children (depth cap). Create form gains a Parent (optionnel) select and locks Kind when a parent is chosen. Delete confirm appends a line explaining that sub-categories become root categories.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Thread `formatCategoryPath` through every row-level surface

**Files:**
- Modify: `frontend/src/pages/Transactions/TransactionRow.tsx:90`
- Modify: `frontend/src/pages/Transactions/TransactionModal.tsx:380`
- Modify: `frontend/src/pages/Transactions/SplitEditor.tsx:193`
- Modify: `frontend/src/pages/Transactions/FiltersBar.tsx:85`
- Modify: `frontend/src/pages/Rules/index.tsx:117`
- Modify: `frontend/src/pages/Rules/CategoryRow.tsx:55`
- Modify: `frontend/src/pages/Rules/RuleCreateForm.tsx:77`
- Modify: `frontend/src/pages/Rules/FlatTable.tsx:66`
- Modify: `frontend/src/pages/Rules/AdvancedEditor.tsx:81`
- Modify: `frontend/src/pages/Rules/Tri.tsx:150,250`
- Modify: `frontend/src/pages/Budgets/index.tsx:154`
- Test: `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`

**Interfaces:**
- Consumes: `formatCategoryPath` from `../../lib/categories` (or the correct relative path per file).
- Produces: no new exports. Every dropdown option label and category cell now uses the shared helper. Pickers sort options by `(parentPath, name)` so children appear right under their parents in the list.

Skip Doublons (`DuplicatesPanel.tsx`) — it never renders category names in-row today (only ids in the API payload).

- [ ] **Step 1: Write the failing test**

Extend `frontend/src/pages/Transactions/__tests__/TransactionRow.test.tsx`. Extend whatever fixture the file uses so one of the categories has a `parentId` set. Add:

```ts
  it('renders a nested category as "Parent › Leaf"', async () => {
    // Fixture: category id=42 { name: 'Alimentation', parentId: 41 };
    //          category id=41 { name: 'Courses', parentId: null };
    //          transaction with categoryId: 42.
    render(<TransactionRow {...propsWithCategory(42)} />, { wrapper: withProviders });
    expect(await screen.findByText('Courses › Alimentation')).toBeInTheDocument();
  });

  it('renders a root category with just its name', async () => {
    render(<TransactionRow {...propsWithCategory(41)} />, { wrapper: withProviders });
    expect(await screen.findByText('Courses')).toBeInTheDocument();
  });
```

(Adjust `propsWithCategory` / `withProviders` to match this file's existing helpers.)

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`:

```bash
npx vitest run src/pages/Transactions/__tests__/TransactionRow.test.tsx
```

Expected: the first case fails — the row currently shows `Alimentation`, not `Courses › Alimentation`.

- [ ] **Step 3: Add a `byId` map at the call sites and swap `c.name` for `formatCategoryPath`**

At each of the modification lines above, follow the same recipe:

1. If the component already has a `categories: Category[]` (or similar) in scope from a `useQuery` or props, add a memoized map right after where it's obtained:
   ```ts
   const byId = useMemo(
     () => new Map(categories.map((c) => [c.id, c] as const)),
     [categories],
   );
   ```
   If `categories` is only in scope via props higher up (e.g. Tri passes them down), lift the `byId` map to the same level as `categories` and pass it down.

2. Replace `{c.name}` with `{formatCategoryPath(c, byId)}` at each numbered line.

3. Add the import (or extend the existing import from `'../../lib/categories'` / adjust the relative depth):
   ```ts
   import { formatCategoryPath } from '../../lib/categories';
   ```

4. For **`<option>` lists** (SplitEditor, TransactionModal, FiltersBar, Budgets, RuleCreateForm, FlatTable, AdvancedEditor, Tri): also sort the list so children sit under their parent. Where the file currently does `categories.map((c) => <option ...>)`, replace with:
   ```tsx
   [...categories]
     .sort((a, b) => {
       const pa = a.parentId != null ? byId.get(a.parentId)?.name ?? '' : a.name;
       const pb = b.parentId != null ? byId.get(b.parentId)?.name ?? '' : b.name;
       return pa.localeCompare(pb) || a.name.localeCompare(b.name);
     })
     .map((c) => <option key={c.id} value={c.id}>{formatCategoryPath(c, byId)}</option>)
   ```

5. For `frontend/src/pages/Rules/index.tsx:117` — the current sort is
   ```ts
   return a.category.name.localeCompare(b.category.name);
   ```
   Change to sort by parent-path first:
   ```ts
   const aPath = a.category.parentId != null
     ? (categoriesById.get(a.category.parentId)?.name ?? '') + ' › ' + a.category.name
     : a.category.name;
   const bPath = b.category.parentId != null
     ? (categoriesById.get(b.category.parentId)?.name ?? '') + ' › ' + b.category.name
     : b.category.name;
   return aPath.localeCompare(bPath);
   ```
   Build `categoriesById` in the same scope from whatever categories list the file already has.

6. For `frontend/src/pages/Rules/CategoryRow.tsx:55` — the row heading. Wrap `{category.name}` with the helper. `byId` must be passed in as a new prop `byId: Map<number, Category>` because this component doesn't fetch categories itself. Also add the new prop to every call site of `CategoryRow` (there is one — in `Rules/index.tsx`, where the categoriesById map is already available after step 5).

- [ ] **Step 4: Run tests to verify they pass**

Run from `frontend/`:

```bash
npx vitest run src/pages/Transactions/__tests__/TransactionRow.test.tsx
npx vitest run src/pages/Rules/__tests__ src/pages/Transactions/__tests__ src/pages/Budgets/__tests__
```

Expected: all pass. If any existing test was asserting `Alimentation` where the fixture had `Alimentation` as a nested category, update the assertion to `Courses › Alimentation` — that assertion was implicitly wrong before (dependent on the flat rendering).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Transactions/ frontend/src/pages/Rules/ frontend/src/pages/Budgets/
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(categories): render "Parent › Leaf" across row-level surfaces

Transactions list, Transactions modal, Split editor, Filters bar, Rules table (+ CategoryRow + RuleCreateForm + FlatTable + AdvancedEditor + Tri) and the Budgets category picker all go through formatCategoryPath. Pickers sort options by (parent path, leaf name) so children sit under their parent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Budgets page — grouped rendering with rollup

**Files:**
- Modify: `frontend/src/pages/Budgets/index.tsx` (list rendering at lines 98-144)
- Create: `frontend/src/pages/Budgets/__tests__/index.test.tsx` (the `__tests__` directory does not exist yet; creating the file creates the directory)
- Modify: `frontend/src/lib/categories.ts` (add `export` in front of `groupCategories` factored out of Task 5)

**Interfaces:**
- Consumes: `useBudgetReport(month)` (already returns rolled-up `spent` for parents thanks to Task 3), `/api/categories` (already fetched by the page).
- Produces: no new exports beyond promoting `groupCategories` to a shared helper. Budgets page mirrors the Categories page structure — parent row followed by indented child rows; parent shows the rollup `spent / limit`, children show their own `spent / — (or leaf limit if set)`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/Budgets/__tests__/index.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Budgets } from '../index';

function withProviders(children: React.ReactNode): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// The `api` module is the project's fetch wrapper (frontend/src/api/client.ts).
// Mock its default export to return canned responses per URL.
vi.mock('../../../api/client', () => ({
  api: vi.fn(async (url: string) => {
    if (url === '/api/categories') {
      return {
        categories: [
          { id: 1, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
          { id: 2, name: 'Alimentation', kind: 'expense', color: null, parentId: 1, isDefault: false, isInternalTransfer: false },
        ],
      };
    }
    if (url.startsWith('/api/reports/budget')) {
      return {
        month: '2026-06',
        rows: [
          { categoryId: 1, name: 'Courses', color: null, limit: '100.00', currency: 'EUR', spent: '80.00', remaining: '20.00', pct: 80, over: false },
          { categoryId: 2, name: 'Alimentation', color: null, limit: '0.00', currency: 'EUR', spent: '30.00', remaining: '-30.00', pct: 0, over: false },
        ],
        totals: { limit: '100.00', spent: '80.00' },
      };
    }
    if (url === '/api/budgets') return { budgets: [{ id: 10, categoryId: 1, monthlyLimit: '100.00', currency: 'EUR' }] };
    throw new Error(`unexpected url ${url}`);
  }),
  ApiError: class ApiError extends Error {},
}));

describe('Budgets page — grouped rendering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a child budget row indented under its parent budget row', async () => {
    render(withProviders(<Budgets />));
    const parent = await screen.findByText('Courses');
    const child = await screen.findByText('Alimentation');
    const parentRow = parent.closest('[data-role="budget-row"]')!;
    const childRow = child.closest('[data-role="budget-row"]')!;
    expect(parentRow.nextElementSibling).toBe(childRow);
    expect(childRow.getAttribute('data-depth')).toBe('1');
    // Parent shows the rollup 80 / 100.
    expect(within(parentRow).getByText(/80.*100/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`:

```bash
npx vitest run src/pages/Budgets/__tests__/index.test.tsx
```

Expected: fails — current page never fetches `/api/categories`, so `Alimentation` never appears (the API mock returns a row for it, but the current implementation only renders `report.rows` in a flat list; more importantly, no `data-role="budget-row"` attribute exists yet).

- [ ] **Step 3: Factor `groupCategories` out to the shared lib**

In `frontend/src/lib/categories.ts`, add:

```ts
export function groupCategories(cats: Category[]): {
  roots: Category[];
  childrenByParent: Map<number, Category[]>;
} {
  const roots: Category[] = [];
  const childrenByParent = new Map<number, Category[]>();
  for (const c of cats) {
    if (c.parentId == null) roots.push(c);
    else {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return { roots, childrenByParent };
}
```

Then in `frontend/src/pages/Rules/Categories.tsx`: delete the local `groupCategories` definition and import it from `../../lib/categories` instead. Existing Categories tests must still pass unchanged.

- [ ] **Step 4: Group budget rows**

In `frontend/src/pages/Budgets/index.tsx`:

1. Add the import (extend the existing categories import):
   ```ts
   import { groupCategories } from '../../lib/categories';
   import type { Category, BudgetReportRow } from '../../api/types';
   ```

2. Right after `const rows = report.data?.rows ?? [];` (line 42), add:
   ```ts
   const cats = categoriesQ.data?.categories ?? [];
   const { roots, childrenByParent } = useMemo(() => groupCategories(cats), [cats]);
   const rowsByCategory = useMemo(
     () => new Map(rows.map((r) => [r.categoryId, r] as const)),
     [rows],
   );
   const visibleRoots = useMemo(
     () => roots.filter((r) => {
       if (rowsByCategory.has(r.id)) return true;
       const children = childrenByParent.get(r.id) ?? [];
       return children.some((c) => rowsByCategory.has(c.id));
     }),
     [roots, childrenByParent, rowsByCategory],
   );
   ```

3. Extract the current `<li>` render body (lines 108-140, the block that starts `<li key={r.categoryId} className="surface p-4">` and ends `</li>`) into a `BudgetLine` component in the same file. Wire depth-aware wrapper classes plus `data-role` / `data-depth` attributes for the test:

   ```tsx
   function BudgetLine(props: {
     row: BudgetReportRow;
     depth: 0 | 1;
     budgetId: number | undefined;
     onSave: (id: number, limit: string) => void;
     onDelete: (id: number) => void;
   }): JSX.Element {
     const { row: r, depth, budgetId, onSave, onDelete } = props;
     const pctClamped = Math.min(Math.max(r.pct, 0), 100);
     return (
       <li
         data-role="budget-row"
         data-depth={depth}
         className={`surface p-4 ${depth === 1 ? 'ml-8 bg-ink-900/20' : ''}`}
       >
         <div className="flex items-center justify-between mb-2">
           <span className="font-medium">{r.name}</span>
           <span className="text-sm tabular-nums private">
             {formatAmount(r.spent, r.currency)} / {Number(r.limit) > 0 ? formatAmount(r.limit, r.currency) : '—'}
           </span>
         </div>
         <div className="h-2 rounded-full bg-ink-800 overflow-hidden">
           <div className={`h-full ${barColor(r.pct, r.over)}`} style={{ width: `${pctClamped}%` }} />
         </div>
         <div className="flex items-center justify-between mt-2">
           <span className={`text-xs ${r.over ? 'text-clay-300' : 'text-ink-400'}`}>
             {r.over ? 'Dépassé de ' : 'Reste '}
             <span className="private">
               {r.over
                 ? formatAmount((-Number(r.remaining)).toFixed(2), r.currency)
                 : formatAmount(r.remaining, r.currency)}
             </span>
           </span>
           <BudgetRowActions
             id={budgetId}
             currentLimit={r.limit}
             onSave={onSave}
             onDelete={onDelete}
           />
         </div>
       </li>
     );
   }
   ```

   Note the two changes from the original inline JSX: (a) wrapping `<li>` gains the two `data-*` attributes and depth-aware class; (b) the `spent / limit` line uses `—` when limit is 0 (child rows without their own budget).

4. Replace the outer `<ul>...{rows.map((r) => …)}</ul>` with:

   ```tsx
   <ul className="flex flex-col gap-3">
     {visibleRoots.flatMap((r) => {
       const rootRow = rowsByCategory.get(r.id);
       const nodes: JSX.Element[] = [];
       if (rootRow) {
         nodes.push(
           <BudgetLine
             key={`root-${r.id}`}
             row={rootRow}
             depth={0}
             budgetId={budgets.find((b) => b.categoryId === r.id)?.id}
             onSave={(id, limit) => update.mutate({ id, monthlyLimit: limit }, {
               onSuccess: () => setMutationError(null),
               onError: (err) => setMutationError(mutationErrorMessage(err)),
             })}
             onDelete={(id) => remove.mutate(id, {
               onSuccess: () => setMutationError(null),
               onError: (err) => setMutationError(mutationErrorMessage(err)),
             })}
           />,
         );
       } else {
         // Parent has no budget of its own but has budgeted children — slim header.
         nodes.push(
           <li key={`header-${r.id}`} data-role="budget-row" data-depth={0} className="px-4 py-2 text-sm text-ink-500">
             {r.name}
           </li>,
         );
       }
       for (const c of childrenByParent.get(r.id) ?? []) {
         const row = rowsByCategory.get(c.id);
         if (!row) continue;
         nodes.push(
           <BudgetLine
             key={`child-${c.id}`}
             row={row}
             depth={1}
             budgetId={budgets.find((b) => b.categoryId === c.id)?.id}
             onSave={(id, limit) => update.mutate({ id, monthlyLimit: limit }, {
               onSuccess: () => setMutationError(null),
               onError: (err) => setMutationError(mutationErrorMessage(err)),
             })}
             onDelete={(id) => remove.mutate(id, {
               onSuccess: () => setMutationError(null),
               onError: (err) => setMutationError(mutationErrorMessage(err)),
             })}
           />,
         );
       }
       return nodes;
     })}
     {/* Also render any budgeted category whose parent isn't visible (orphaned leaf edge case). */}
     {rows
       .filter((r) => !visibleRoots.some((vr) => vr.id === r.categoryId || (childrenByParent.get(vr.id) ?? []).some((c) => c.id === r.categoryId)))
       .map((r) => (
         <BudgetLine
           key={`orphan-${r.categoryId}`}
           row={r}
           depth={0}
           budgetId={budgets.find((b) => b.categoryId === r.categoryId)?.id}
           onSave={(id, limit) => update.mutate({ id, monthlyLimit: limit }, {
             onSuccess: () => setMutationError(null),
             onError: (err) => setMutationError(mutationErrorMessage(err)),
           })}
           onDelete={(id) => remove.mutate(id, {
             onSuccess: () => setMutationError(null),
             onError: (err) => setMutationError(mutationErrorMessage(err)),
           })}
         />
       ))}
   </ul>
   ```

- [ ] **Step 5: Run test to verify it passes**

Run from `frontend/`:

```bash
npx vitest run src/pages/Budgets/__tests__/index.test.tsx
```

Also re-run the Categories page tests to prove the `groupCategories` factoring didn't regress:

```bash
npx vitest run src/pages/Rules/__tests__/Categories.test.tsx
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Budgets/ frontend/src/lib/categories.ts frontend/src/pages/Rules/Categories.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(budgets): grouped rendering with parent-rollup rows

Budgets page mirrors the Categories page structure. Parent budget row shows the rollup spent/limit (server rolled up in the /api/reports/budget query); child rows show own spent and (optional) leaf limit. Parents without a budget but with budgeted children render a slim header so the group is legible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Insights — rank top movers at the root level

**Files:**
- Modify: `frontend/src/pages/Dashboard/insights.ts`
- Test: `frontend/src/pages/Dashboard/__tests__/insights.test.ts`

**Interfaces:**
- Consumes: `CategoryReportRow[]`, `Category[]`, `rootOf`-style helper (or inline the walk).
- Produces: no shape change. Same `Insight[]` return, but the top-mover ranking works on rolled-up root categories.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/Dashboard/__tests__/insights.test.ts`:

```ts
  it('ranks top category movers at the root level', () => {
    const cats: Category[] = [
      { id: 1, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
      { id: 2, name: 'Alimentation', kind: 'expense', color: null, parentId: 1, isDefault: false, isInternalTransfer: false },
      { id: 3, name: 'Ménage', kind: 'expense', color: null, parentId: 1, isDefault: false, isInternalTransfer: false },
      { id: 4, name: 'Loisirs', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
    ];
    // Two leaves of Courses both went up modestly. Loisirs went up a bit more than either
    // leaf alone, but less than Courses's rollup — so Courses should be the top mover.
    const rows: CategoryReportRow[] = [
      row(2, 'expense', '-300', '2026-05'),
      row(3, 'expense', '-100', '2026-05'),
      row(2, 'expense', '-400', '2026-06'),
      row(3, 'expense', '-200', '2026-06'),
      row(4, 'expense', '-500', '2026-05'),
      row(4, 'expense', '-650', '2026-06'),
    ];
    const insights = buildInsights(rows, cats, '2026-06');
    const topMover = insights.find((i) => i.headline?.startsWith('Plus forte hausse'));
    expect(topMover?.headline).toBe('Plus forte hausse : Courses');
  });
```

Add the `row` helper if the file doesn't have one already:

```ts
function row(id: number, kind: 'expense' | 'income', total: string, month: string): CategoryReportRow {
  return {
    category_id: id, category_name: null, category_kind: kind,
    category_is_internal_transfer: false, month, total, transaction_count: 1,
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/`:

```bash
npx vitest run src/pages/Dashboard/__tests__/insights.test.ts
```

Expected: fails — current logic ranks the leaves individually, so `Loisirs (+150)` wins over `Alimentation (+100)` or `Ménage (+100)`, even though `Courses` rollup is `+200`.

- [ ] **Step 3: Roll up before ranking**

In `frontend/src/pages/Dashboard/insights.ts`, in the section that walks category rows to find `topInc` / `topDec`, aggregate at the root before comparing. Sketch:

```ts
function rootIdOf(catId: number, byId: Map<number, Category>): number {
  const seen = new Set<number>();
  let cur = byId.get(catId);
  while (cur && cur.parentId != null && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId)!;
  }
  return cur ? cur.id : catId;
}

// Before the existing per-category loop that populates topInc/topDec, build:
const byId = new Map(categories.map((c) => [c.id, c]));
const rolledUpByRoot = new Map<number, { current: number; previous: number; kind: string }>();
for (const r of rows) {
  if (r.category_id == null || !r.category_kind) continue;
  const rootId = rootIdOf(r.category_id, byId);
  const bucket = rolledUpByRoot.get(rootId) ?? { current: 0, previous: 0, kind: r.category_kind };
  if (r.month === currentMonth) bucket.current += Math.abs(Number(r.total));
  else if (r.month === previousMonth) bucket.previous += Math.abs(Number(r.total));
  rolledUpByRoot.set(rootId, bucket);
}

// Then iterate rolledUpByRoot instead of raw rows to compute topInc / topDec.
// The `name` used in headlines is `byId.get(rootId)?.name` — always a root name.
```

Do not touch `savings rate`, `spend delta`, `income delta` — those aggregate globally and are unaffected by root-vs-leaf.

- [ ] **Step 4: Run test to verify it passes**

Run from `frontend/`:

```bash
npx vitest run src/pages/Dashboard/__tests__/insights.test.ts
```

Expected: all cases pass. Existing insights tests without nested categories still pass because a flat category is its own root.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/insights.ts frontend/src/pages/Dashboard/__tests__/insights.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(insights): roll top-mover ranking up to root categories

Aggregate report rows by root ancestor before ranking spend increases/decreases. A parent category (Courses) now outranks its individual children (Alimentation, Ménage) in the "Plus forte hausse/baisse" headlines, matching the mental model.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Manual smoke checklist (before declaring done)

Run once the whole plan is merged — this is what actually catches integration gaps. Follow the `superpowers:verification-before-completion` skill: exercise each flow in the app, don't just trust tests.

- [ ] Create `Courses (dépense)` → add `Alimentation` under it → confirm Kind picker is disabled with the "hérité de Courses" tooltip.
- [ ] Create `Restaurant` under `Loisirs`; create another `Restaurant` under `Voyages` → both accepted. Attempt to create a second `Restaurant` under `Loisirs` → 409.
- [ ] Try to change `Alimentation`'s parent to itself via the Parent select — the option isn't offered; forcing via the URL / manual PUT → 400.
- [ ] Assign a real transaction to `Alimentation` → open the Dashboard Sankey → the `Courses` node's amount reflects the assignment.
- [ ] Set a budget on `Courses` (100€) → assign −80€ to `Alimentation` → Budgets page shows `80 / 100`, `80%`, not over.
- [ ] Set a leaf-only limit on `Alimentation` (50€) → child row shows its own limit; parent row still shows the rollup.
- [ ] Delete `Courses` → its children now render as top-level roots (with their own kind, unchanged).
- [ ] Change `Groupe`'s kind from `dépense` to `neutre` while it has children → confirm the modal appears, click OK, verify every child now shows `neutre` in the Kind column.
- [ ] Open Transactions → nested categories render as `Courses › Alimentation`; root categories still render as plain names.
- [ ] Open Insights → "Plus forte hausse / baisse" headline shows a root name.
- [ ] Trigger a backup export → confirm the JSON's `parent` field is populated for children → restore into a fresh DB → confirm the tree is restored.
