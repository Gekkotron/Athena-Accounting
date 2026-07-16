# Budget modes (Plafonds + Enveloppes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an envelope-budgeting mode ("Enveloppes") alongside the existing spending-cap mode ("Plafonds"), fully independent, in one contiguous series of commits on `main`.

**Architecture:** Three new DB tables orthogonal to `category_budgets`; a pure `envelope-math` library (server + client mirror); a new Fastify route module at `/api/envelopes/*` with one report endpoint doing the heavy SQL work; a new Enveloppes page under `pages/Budgets/Enveloppes/` reached from a two-child nav hub; a self-hiding Dashboard tile.

**Tech Stack:** PostgreSQL, Drizzle ORM, Fastify + Zod, Vitest, React + Vite, TanStack Query, Tailwind, `parseDecimal`/`formatAmount` for French decimal handling.

**Reference spec:** [`docs/superpowers/specs/2026-07-16-budget-modes-design.md`](../specs/2026-07-16-budget-modes-design.md)

## Global Constraints

- **Commit convention** — commit directly to `main`; no branches; do not push (project policy).
- **Git identity per commit** — always pass `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com` (do NOT modify `.git/config`).
- **No new dependencies** — reuse existing libraries (`zod`, `drizzle-orm`, `@tanstack/react-query`, `vitest`). If a task feels like it needs a package add, stop and confirm.
- **Public-safe** — no IPs, no hostnames, no secrets, no personal identifiers in any file.
- **French UI text** — all user-facing strings are French; test assertions match the exact French text.
- **Decimal inputs** — never `<input type="number">`; always `text` + `inputMode="decimal"` + `parseDecimal` (memory-locked convention).
- **Money on the wire** — strings, not numbers. Follow the `positiveDecimal` pattern in `backend/src/http/routes/budgets.ts:8`.
- **Data-dependent tests** — backend integration tests skip unless `RUN_DB_TESTS=1` (see `backend/tests/budgets-route.test.ts:5` for the pattern).
- **File attribution** — new files with a byline attribute to `Gekkotron`.

---

## Task 1: Migrations + Drizzle schema

**Files:**
- Create: `backend/src/db/migrations/0024_envelope_assignments.sql`
- Create: `backend/src/db/migrations/0025_envelope_category_settings.sql`
- Create: `backend/src/db/migrations/0026_envelope_month_holds.sql`
- Modify: `backend/src/db/schema.ts` (add three Drizzle table defs; add comment on `categoryBudgets`)

**Interfaces:**
- Consumes: existing tables `users`, `categories`, `accounts`.
- Produces: Drizzle table exports `envelopeAssignments`, `envelopeCategorySettings`, `envelopeMonthHolds`; TypeScript types via `$inferSelect`/`$inferInsert` for later route handlers.

- [ ] **Step 1: Write the failing schema-shape test**

Create `backend/tests/envelope-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  envelopeAssignments,
  envelopeCategorySettings,
  envelopeMonthHolds,
} from '../src/db/schema.js';

describe('envelope schema', () => {
  it('exports envelope_assignments with expected columns', () => {
    const cols = Object.keys(envelopeAssignments);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id', 'userId', 'categoryId', 'month', 'amount', 'currency',
        'createdAt', 'updatedAt',
      ]),
    );
  });

  it('exports envelope_category_settings with target and policy columns', () => {
    const cols = Object.keys(envelopeCategorySettings);
    expect(cols).toEqual(
      expect.arrayContaining([
        'userId', 'categoryId', 'targetAmount', 'targetDate',
        'targetKind', 'overspendPolicy', 'updatedAt',
      ]),
    );
  });

  it('exports envelope_month_holds with month PK', () => {
    const cols = Object.keys(envelopeMonthHolds);
    expect(cols).toEqual(
      expect.arrayContaining(['userId', 'month', 'amount', 'updatedAt']),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run backend/tests/envelope-schema.test.ts`
Expected: FAIL — imports do not exist.

- [ ] **Step 3: Write migration 0024 (envelope_assignments)**

Create `backend/src/db/migrations/0024_envelope_assignments.sql`:

```sql
-- Envelope assignments: per-month allocation per category. Under the
-- envelope model, income is allocated forward one month at a time;
-- this table stores those allocations. Amount may be negative — the
-- reallocation flow writes two rows atomically (source -= X, dest += X).
-- UNIQUE(user, category, month) => at most one assignment per envelope
-- per month. Month is stored as the first-of-month DATE.
CREATE TABLE envelope_assignments (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month        DATE    NOT NULL,
  amount       NUMERIC(14, 2) NOT NULL,
  currency     VARCHAR(3) NOT NULL DEFAULT 'EUR',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id, month),
  CHECK (EXTRACT(DAY FROM month) = 1)
);
CREATE INDEX envelope_assignments_user_month_idx
  ON envelope_assignments (user_id, month);
```

- [ ] **Step 4: Write migration 0025 (envelope_category_settings)**

Create `backend/src/db/migrations/0025_envelope_category_settings.sql`:

```sql
-- Per-envelope config: optional target (goal amount + optional date +
-- kind) and the overspend policy. Row exists only when the user
-- configures something. Absence = defaults (rollover_negative, no target).
-- Composite PK on (user_id, category_id) — one settings row per envelope.
CREATE TABLE envelope_category_settings (
  user_id           INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category_id       INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  target_amount     NUMERIC(14, 2),
  target_date       DATE,
  target_kind       TEXT
                    CHECK (target_kind IN
                      ('save_by_date', 'monthly_recurring', 'save_up_to')),
  overspend_policy  TEXT NOT NULL DEFAULT 'rollover_negative'
                    CHECK (overspend_policy IN
                      ('rollover_negative', 'reallocate_manual')),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_id)
);
```

- [ ] **Step 5: Write migration 0026 (envelope_month_holds)**

Create `backend/src/db/migrations/0026_envelope_month_holds.sql`:

```sql
-- "Hold for next month" buffer. A hold on month M deducts from month
-- M's pool and releases into month M+1's pool. amount = 0 is invalid
-- (the route deletes the row instead of writing a 0).
CREATE TABLE envelope_month_holds (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month        DATE    NOT NULL,
  amount       NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month),
  CHECK (EXTRACT(DAY FROM month) = 1)
);
```

- [ ] **Step 6: Add Drizzle table defs**

In `backend/src/db/schema.ts`, add above the existing exports (adjust imports if needed — `date`, `numeric`, `serial`, `text`, `timestamp`, `pgTable`, `varchar`, `integer`, `primaryKey`, `uniqueIndex`, `index` from `drizzle-orm/pg-core`):

```ts
export const envelopeAssignments = pgTable(
  'envelope_assignments',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
    month: date('month').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('envelope_assignments_user_cat_month_uq')
      .on(t.userId, t.categoryId, t.month),
    byUserMonth: index('envelope_assignments_user_month_idx')
      .on(t.userId, t.month),
  }),
);

export const envelopeCategorySettings = pgTable(
  'envelope_category_settings',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
    targetAmount: numeric('target_amount', { precision: 14, scale: 2 }),
    targetDate: date('target_date'),
    targetKind: text('target_kind'),
    overspendPolicy: text('overspend_policy').notNull().default('rollover_negative'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.categoryId] }) }),
);

export const envelopeMonthHolds = pgTable(
  'envelope_month_holds',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    month: date('month').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.month] }) }),
);
```

Also add a one-line comment above `categoryBudgets` in the same file: `// Spending-cap mode ("Plafonds"). Envelope-mode data lives in envelope_* tables.`

- [ ] **Step 7: Run schema tests to verify they pass**

Run: `npx vitest run backend/tests/envelope-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/db/migrations/0024_envelope_assignments.sql \
  backend/src/db/migrations/0025_envelope_category_settings.sql \
  backend/src/db/migrations/0026_envelope_month_holds.sql \
  backend/src/db/schema.ts \
  backend/tests/envelope-schema.test.ts

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(db): envelope tables — assignments, settings, month holds"
```

---

## Task 2: Server envelope-math library

**Files:**
- Create: `backend/src/lib/envelope-math.ts`
- Create: `backend/tests/envelope-math.test.ts`

**Interfaces:**
- Consumes: nothing DB-specific — pure math on plain records.
- Produces:
  ```ts
  type Money = string;  // "1234.56"
  interface AssignmentRow { categoryId: number; month: string /* YYYY-MM-01 */; amount: Money }
  interface SpendRow      { categoryId: number; month: string; amount: Money }
  interface HoldRow       { month: string; amount: Money }
  interface PolicyRow     { categoryId: number; overspendPolicy: 'rollover_negative' | 'reallocate_manual' }

  export function computeCategoryBalances(
    upToMonth: string, // "YYYY-MM-01"
    assignments: AssignmentRow[],
    spends: SpendRow[],
    policies: PolicyRow[],
  ): Map<number, { balance: Money; absorbedByPool: Money; overspent: boolean }>;

  export function computePool(args: {
    upToMonth: string;
    incomeCumulative: Money;
    assignmentCumulative: Money;
    holdThisMonth: Money;
    holdPriorMonth: Money;
    totalAbsorbedPriorMonth: Money;
  }): { available: Money; heldFromPriorMonths: Money; heldForNextMonth: Money };

  export function reallocate(
    from: AssignmentRow | null,
    to: AssignmentRow | null,
    amount: Money,
  ): { from: AssignmentRow; to: AssignmentRow };
  ```

- [ ] **Step 1: Write the failing tests (fixtures for all three formulas)**

Create `backend/tests/envelope-math.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeCategoryBalances,
  computePool,
  reallocate,
} from '../src/lib/envelope-math.js';

const M = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, '0')}-01`;

describe('computeCategoryBalances — rollover_negative (default)', () => {
  it('folds cumulative assignments minus spend', () => {
    const r = computeCategoryBalances(
      M(2026, 7),
      [
        { categoryId: 1, month: M(2026, 6), amount: '100.00' },
        { categoryId: 1, month: M(2026, 7), amount: '450.00' },
      ],
      [
        { categoryId: 1, month: M(2026, 6), amount: '20.00' },
        { categoryId: 1, month: M(2026, 7), amount: '510.00' },
      ],
      [],
    );
    // Prior balance = 100 - 20 = 80; then + 450 - 510 = 20
    expect(r.get(1)!.balance).toBe('20.00');
    expect(r.get(1)!.absorbedByPool).toBe('0.00');
    expect(r.get(1)!.overspent).toBe(false);
  });

  it('lets balance go negative and carry', () => {
    const r = computeCategoryBalances(
      M(2026, 7),
      [{ categoryId: 1, month: M(2026, 7), amount: '30.00' }],
      [{ categoryId: 1, month: M(2026, 7), amount: '95.00' }],
      [],
    );
    expect(r.get(1)!.balance).toBe('-65.00');
    expect(r.get(1)!.overspent).toBe(true);
    expect(r.get(1)!.absorbedByPool).toBe('0.00');
  });
});

describe('computeCategoryBalances — reallocate_manual', () => {
  it('resets to 0 next month and reports absorbed amount', () => {
    const r = computeCategoryBalances(
      M(2026, 7),
      [
        { categoryId: 1, month: M(2026, 6), amount: '30.00' },
        { categoryId: 1, month: M(2026, 7), amount: '0.00' },
      ],
      [
        { categoryId: 1, month: M(2026, 6), amount: '95.00' }, // overspend 65
        { categoryId: 1, month: M(2026, 7), amount: '10.00' },
      ],
      [{ categoryId: 1, overspendPolicy: 'reallocate_manual' }],
    );
    // June carry = 0 (absorbed 65). July raw = 0 + 0 - 10 = -10.
    expect(r.get(1)!.balance).toBe('-10.00');
    expect(r.get(1)!.absorbedByPool).toBe('10.00'); // this month's own absorb
    expect(r.get(1)!.overspent).toBe(true);
  });

  it('never shows negative carry across months', () => {
    const r = computeCategoryBalances(
      M(2026, 8),
      [
        { categoryId: 1, month: M(2026, 6), amount: '30.00' },
        { categoryId: 1, month: M(2026, 7), amount: '0.00' },
        { categoryId: 1, month: M(2026, 8), amount: '50.00' },
      ],
      [
        { categoryId: 1, month: M(2026, 6), amount: '95.00' }, // absorb 65
        { categoryId: 1, month: M(2026, 7), amount: '0.00' },
        { categoryId: 1, month: M(2026, 8), amount: '10.00' },
      ],
      [{ categoryId: 1, overspendPolicy: 'reallocate_manual' }],
    );
    // July carry = 0, August raw = 0 + 50 - 10 = 40
    expect(r.get(1)!.balance).toBe('40.00');
    expect(r.get(1)!.absorbedByPool).toBe('0.00');
  });
});

describe('computePool', () => {
  it('applies hold(M-1) release, hold(M) subtract, and prior absorb', () => {
    const p = computePool({
      upToMonth: M(2026, 7),
      incomeCumulative: '18400.00',
      assignmentCumulative: '16900.00',
      holdThisMonth: '0.00',
      holdPriorMonth: '500.00',
      totalAbsorbedPriorMonth: '260.00',
    });
    // 18400 - 16900 - 0 + 500 - 260 = 1740
    expect(p.available).toBe('1740.00');
    expect(p.heldFromPriorMonths).toBe('500.00');
    expect(p.heldForNextMonth).toBe('0.00');
  });

  it('goes negative when over-assigned', () => {
    const p = computePool({
      upToMonth: M(2026, 7),
      incomeCumulative: '1000.00',
      assignmentCumulative: '1500.00',
      holdThisMonth: '0.00',
      holdPriorMonth: '0.00',
      totalAbsorbedPriorMonth: '0.00',
    });
    expect(p.available).toBe('-500.00');
  });
});

describe('reallocate', () => {
  it('subtracts from source, adds to dest, atomic in memory', () => {
    const { from, to } = reallocate(
      { categoryId: 1, month: M(2026, 7), amount: '100.00' },
      { categoryId: 2, month: M(2026, 7), amount: '50.00' },
      '30.00',
    );
    expect(from.amount).toBe('70.00');
    expect(to.amount).toBe('80.00');
  });

  it('treats a null side as an implicit 0 starting row', () => {
    const { from, to } = reallocate(
      null,
      { categoryId: 2, month: M(2026, 7), amount: '0.00' },
      '25.00',
    );
    expect(from.amount).toBe('-25.00');
    expect(to.amount).toBe('25.00');
  });
});
```

- [ ] **Step 2: Run to verify all fail**

Run: `npx vitest run backend/tests/envelope-math.test.ts`
Expected: FAIL — imports missing.

- [ ] **Step 3: Implement `envelope-math.ts`**

Create `backend/src/lib/envelope-math.ts`:

```ts
// Pure envelope-budgeting math. No I/O, no DB, no Drizzle types — takes
// plain records and returns plain records. See spec §Semantics for the
// formulas this file implements verbatim.

export type Money = string;

export interface AssignmentRow {
  categoryId: number;
  month: string;     // "YYYY-MM-01"
  amount: Money;     // signed decimal string
}

export interface SpendRow {
  categoryId: number;
  month: string;
  amount: Money;     // always >= 0 in normal use
}

export interface PolicyRow {
  categoryId: number;
  overspendPolicy: 'rollover_negative' | 'reallocate_manual';
}

// Money arithmetic — use cents-integer math internally, format back to
// "X.YY" on the way out. Everything is stored as NUMERIC(14,2) in PG,
// so cents fits in a JS number (safe up to 2^53).
const toCents = (m: Money): number => Math.round(Number(m) * 100);
const fromCents = (c: number): Money => (c / 100).toFixed(2);

const monthKey = (m: string): string => m.slice(0, 7);
const compareMonth = (a: string, b: string): number => monthKey(a).localeCompare(monthKey(b));

export function computeCategoryBalances(
  upToMonth: string,
  assignments: AssignmentRow[],
  spends: SpendRow[],
  policies: PolicyRow[],
): Map<number, { balance: Money; absorbedByPool: Money; overspent: boolean }> {
  const policyBy = new Map(policies.map((p) => [p.categoryId, p.overspendPolicy]));
  const catIds = new Set<number>([
    ...assignments.map((a) => a.categoryId),
    ...spends.map((s) => s.categoryId),
  ]);
  const out = new Map<number, { balance: Money; absorbedByPool: Money; overspent: boolean }>();

  for (const catId of catIds) {
    const catAssigns = assignments
      .filter((a) => a.categoryId === catId && compareMonth(a.month, upToMonth) <= 0)
      .sort((x, y) => compareMonth(x.month, y.month));
    const catSpends = spends
      .filter((s) => s.categoryId === catId && compareMonth(s.month, upToMonth) <= 0)
      .sort((x, y) => compareMonth(x.month, y.month));

    const monthsSet = new Set<string>([
      ...catAssigns.map((a) => monthKey(a.month)),
      ...catSpends.map((s) => monthKey(s.month)),
    ]);
    const months = [...monthsSet].sort();

    const policy = policyBy.get(catId) ?? 'rollover_negative';
    let carry = 0;
    let absorbedThisMonth = 0;

    for (const mk of months) {
      const asgn = catAssigns
        .filter((a) => monthKey(a.month) === mk)
        .reduce((s, a) => s + toCents(a.amount), 0);
      const spend = catSpends
        .filter((s) => monthKey(s.month) === mk)
        .reduce((s, r) => s + toCents(r.amount), 0);
      const raw = carry + asgn - spend;

      if (mk === monthKey(upToMonth)) {
        absorbedThisMonth = policy === 'reallocate_manual' && raw < 0 ? -raw : 0;
      }
      carry = policy === 'reallocate_manual' ? Math.max(0, raw) : raw;
      // When we've passed upToMonth (shouldn't happen given filter) stop.
    }

    // The `carry` after processing upToMonth IS the balance for that
    // month under rollover; under reallocate_manual it's the non-negative
    // remainder. If we processed no months for this cat but requested
    // upToMonth, both stay 0.
    const balance = fromCents(carry);
    out.set(catId, {
      balance,
      absorbedByPool: fromCents(absorbedThisMonth),
      overspent: policy === 'rollover_negative' ? carry < 0 : absorbedThisMonth > 0,
    });
  }

  return out;
}

export function computePool(args: {
  upToMonth: string;
  incomeCumulative: Money;
  assignmentCumulative: Money;
  holdThisMonth: Money;
  holdPriorMonth: Money;
  totalAbsorbedPriorMonth: Money;
}): { available: Money; heldFromPriorMonths: Money; heldForNextMonth: Money } {
  const inc = toCents(args.incomeCumulative);
  const asg = toCents(args.assignmentCumulative);
  const hM = toCents(args.holdThisMonth);
  const hPrev = toCents(args.holdPriorMonth);
  const absorb = toCents(args.totalAbsorbedPriorMonth);
  const available = inc - asg - hM + hPrev - absorb;
  return {
    available: fromCents(available),
    heldFromPriorMonths: fromCents(hPrev),
    heldForNextMonth: fromCents(hM),
  };
}

export function reallocate(
  from: AssignmentRow | null,
  to: AssignmentRow | null,
  amount: Money,
): { from: AssignmentRow; to: AssignmentRow } {
  if (!from && !to) throw new Error('reallocate: both sides null');
  if (from && to && from.categoryId === to.categoryId && from.month === to.month) {
    throw new Error('reallocate: same envelope');
  }
  const a = toCents(amount);
  const fromRow: AssignmentRow = from ?? {
    categoryId: (to as AssignmentRow).categoryId, // placeholder; caller supplies real id
    month: (to as AssignmentRow).month,
    amount: '0.00',
  };
  const toRow: AssignmentRow = to ?? {
    categoryId: (from as AssignmentRow).categoryId,
    month: (from as AssignmentRow).month,
    amount: '0.00',
  };
  return {
    from: { ...fromRow, amount: fromCents(toCents(fromRow.amount) - a) },
    to:   { ...toRow,   amount: fromCents(toCents(toRow.amount)   + a) },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run backend/tests/envelope-math.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/lib/envelope-math.ts \
  backend/tests/envelope-math.test.ts

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): pure math for balances, pool, reallocation"
```

---

## Task 3: Assignments route (GET / PUT / DELETE)

**Files:**
- Create: `backend/src/http/routes/envelopes.ts` (initial skeleton + assignments handlers)
- Modify: `backend/src/server.ts` — register `envelopesRoutes` next to `budgetsRoutes` at line ~28.
- Create: `backend/tests/envelopes-route.test.ts` (assignments cases only in this task)

**Interfaces:**
- Consumes: `envelopeAssignments`, `categories`, `expenseCategoryOwned` pattern from `budgets.ts:60`.
- Produces: three endpoints:
  ```
  GET    /api/envelopes/assignments?month=YYYY-MM
         → { assignments: [{ id, categoryId, month, amount, currency }] }
  PUT    /api/envelopes/assignments  body { categoryId, month, amount, currency? }
         → 201 { assignment }  (upsert)
  DELETE /api/envelopes/assignments/:id  → 204
  ```

- [ ] **Step 1: Write failing route tests**

Create `backend/tests/envelopes-route.test.ts`:

```ts
// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let expenseCatId: number;
let incomeCatId: number;

describe.skipIf(!RUN)('/api/envelopes/assignments', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'env-user', password: 'env-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'env-user', password: 'env-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    const exp = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie }, payload: { name: 'Alimentation', kind: 'expense' },
    });
    expenseCatId = exp.json().category.id;
    const inc = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie }, payload: { name: 'Salaire', kind: 'income' },
    });
    incomeCatId = inc.json().category.id;
  });

  it('rejects PUT without auth', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments',
      payload: { categoryId: expenseCatId, month: '2026-07', amount: '100.00' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('rejects PUT for income category', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments',
      headers: { cookie },
      payload: { categoryId: incomeCatId, month: '2026-07', amount: '100.00' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('category_not_expense');
  });

  it('upserts assignment (create then update)', async () => {
    const create = await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments',
      headers: { cookie },
      payload: { categoryId: expenseCatId, month: '2026-07', amount: '450.00' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().assignment.amount).toBe('450.00');
    expect(create.json().assignment.month).toBe('2026-07');

    const update = await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments',
      headers: { cookie },
      payload: { categoryId: expenseCatId, month: '2026-07', amount: '500.00' },
    });
    expect(update.statusCode).toBe(201);
    expect(update.json().assignment.amount).toBe('500.00');
  });

  it('accepts negative amounts', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments',
      headers: { cookie },
      payload: { categoryId: expenseCatId, month: '2026-08', amount: '-30.00' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().assignment.amount).toBe('-30.00');
  });

  it('lists this user\'s assignments for a month', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/envelopes/assignments?month=2026-07',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    const rows = r.json().assignments;
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe('500.00');
  });

  it('DELETE 404s on unknown id', async () => {
    const r = await app.inject({
      method: 'DELETE', url: '/api/envelopes/assignments/999999',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to see failures**

Run: `RUN_DB_TESTS=1 npx vitest run backend/tests/envelopes-route.test.ts`
Expected: FAIL — route not registered (404s / handler missing).

- [ ] **Step 3: Create route module skeleton with assignments handlers**

Create `backend/src/http/routes/envelopes.ts`:

```ts
// Envelope-mode budgeting routes. Independent of /api/budgets — the two
// modes do not share tables. See docs/superpowers/specs/2026-07-16-budget-modes-design.md.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  categories,
  envelopeAssignments,
} from '../../db/schema.js';
import { userId } from '../plugins/auth.js';

const signedDecimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

const monthStr = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM')
  .transform((s) => `${s}-01`);

const currency = z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code');

const IdParam = z.object({ id: z.coerce.number().int().positive() });

function parseId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = IdParam.safeParse(req.params);
  if (!r.success) { reply.code(400).send({ error: 'invalid id' }); return null; }
  return r.data.id;
}

async function expenseCategoryOwned(uid: number, categoryId: number): Promise<boolean> {
  const [row] = await db
    .select({ kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, uid)));
  return !!row && row.kind === 'expense';
}

function serializeAssignment(row: typeof envelopeAssignments.$inferSelect) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    month: row.month,          // "YYYY-MM-01"
    amount: row.amount,
    currency: row.currency,
  };
}

export async function envelopesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // ---------- Assignments ----------

  const AsgListQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
  app.get('/api/envelopes/assignments', async (req, reply) => {
    const uid = userId(req);
    const parsed = AsgListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid month' });
    const month = `${parsed.data.month}-01`;
    const rows = await db
      .select()
      .from(envelopeAssignments)
      .where(and(eq(envelopeAssignments.userId, uid), eq(envelopeAssignments.month, month)))
      .orderBy(asc(envelopeAssignments.categoryId));
    return { assignments: rows.map(serializeAssignment) };
  });

  const AsgPutBody = z.object({
    categoryId: z.number().int().positive(),
    month: monthStr,
    amount: signedDecimal,
    currency: currency.optional(),
  });
  app.put('/api/envelopes/assignments', async (req, reply) => {
    const uid = userId(req);
    const parsed = AsgPutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (!(await expenseCategoryOwned(uid, parsed.data.categoryId))) {
      return reply.code(400).send({ error: 'category_not_expense' });
    }
    const [row] = await db
      .insert(envelopeAssignments)
      .values({
        userId: uid,
        categoryId: parsed.data.categoryId,
        month: parsed.data.month,
        amount: parsed.data.amount,
        currency: parsed.data.currency ?? 'EUR',
      })
      .onConflictDoUpdate({
        target: [envelopeAssignments.userId, envelopeAssignments.categoryId, envelopeAssignments.month],
        set: {
          amount: sql`excluded.amount`,
          currency: sql`excluded.currency`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return reply.code(201).send({ assignment: serializeAssignment(row!) });
  });

  app.delete('/api/envelopes/assignments/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [deleted] = await db
      .delete(envelopeAssignments)
      .where(and(eq(envelopeAssignments.id, id), eq(envelopeAssignments.userId, uid)))
      .returning({ id: envelopeAssignments.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Register the route in `backend/src/server.ts`**

At `backend/src/server.ts` line 28 area, next to `budgetsRoutes`, add:

```ts
import { envelopesRoutes } from './http/routes/envelopes.js';
```

And where `budgetsRoutes` is registered (find `app.register(budgetsRoutes)` — if not present, add near the other route registrations around lines 63–71), add on the next line:

```ts
await app.register(envelopesRoutes);
```

- [ ] **Step 5: Run tests to verify pass**

Run: `RUN_DB_TESTS=1 npx vitest run backend/tests/envelopes-route.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/http/routes/envelopes.ts \
  backend/src/server.ts \
  backend/tests/envelopes-route.test.ts

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): assignments route (list, upsert, delete)"
```

---

## Task 4: Reallocate route (atomic)

**Files:**
- Modify: `backend/src/http/routes/envelopes.ts`
- Modify: `backend/tests/envelopes-route.test.ts`

**Interfaces:**
- Consumes: `envelopeAssignments`, `db.transaction`.
- Produces: `POST /api/envelopes/reallocate` body `{ fromCategoryId, toCategoryId, month, amount }` → `{ from, to }` (both updated rows).

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/envelopes-route.test.ts` (inside a new `describe` block):

```ts
describe.skipIf(!RUN)('/api/envelopes/reallocate', () => {
  let catA: number;
  let catB: number;
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'realloc-user', password: 'realloc-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'realloc-user', password: 'realloc-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    const a = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie }, payload: { name: 'A', kind: 'expense' },
    });
    catA = a.json().category.id;
    const b = await app.inject({
      method: 'POST', url: '/api/categories',
      headers: { cookie }, payload: { name: 'B', kind: 'expense' },
    });
    catB = b.json().category.id;
    await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments', headers: { cookie },
      payload: { categoryId: catA, month: '2026-07', amount: '100.00' },
    });
    await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments', headers: { cookie },
      payload: { categoryId: catB, month: '2026-07', amount: '50.00' },
    });
  });

  it('subtracts from source and adds to dest atomically', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/envelopes/reallocate', headers: { cookie },
      payload: { fromCategoryId: catA, toCategoryId: catB, month: '2026-07', amount: '30.00' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().from.amount).toBe('70.00');
    expect(r.json().to.amount).toBe('80.00');
  });

  it('creates a zero-based source row if none exists this month', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/envelopes/reallocate', headers: { cookie },
      payload: { fromCategoryId: catA, toCategoryId: catB, month: '2026-09', amount: '10.00' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().from.amount).toBe('-10.00');
    expect(r.json().to.amount).toBe('10.00');
  });

  it('rejects same category', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/envelopes/reallocate', headers: { cookie },
      payload: { fromCategoryId: catA, toCategoryId: catA, month: '2026-07', amount: '5.00' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('same_category');
  });
});
```

- [ ] **Step 2: Run to see failures**

Run: `RUN_DB_TESTS=1 npx vitest run backend/tests/envelopes-route.test.ts`
Expected: FAIL on reallocate cases.

- [ ] **Step 3: Add the reallocate handler**

In `backend/src/http/routes/envelopes.ts`, inside `envelopesRoutes(app)` after the DELETE handler, add:

```ts
const ReallocBody = z.object({
  fromCategoryId: z.number().int().positive(),
  toCategoryId: z.number().int().positive(),
  month: monthStr,
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'must be a positive decimal'),
});
app.post('/api/envelopes/reallocate', async (req, reply) => {
  const uid = userId(req);
  const parsed = ReallocBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
  }
  const { fromCategoryId, toCategoryId, month, amount } = parsed.data;
  if (fromCategoryId === toCategoryId) {
    return reply.code(400).send({ error: 'same_category' });
  }
  if (!(await expenseCategoryOwned(uid, fromCategoryId))
    || !(await expenseCategoryOwned(uid, toCategoryId))) {
    return reply.code(400).send({ error: 'category_not_expense' });
  }

  const result = await db.transaction(async (tx) => {
    async function bumpBy(catId: number, delta: string) {
      // Upsert: current amount is unknown; use SQL expression to add.
      const [existing] = await tx
        .select()
        .from(envelopeAssignments)
        .where(and(
          eq(envelopeAssignments.userId, uid),
          eq(envelopeAssignments.categoryId, catId),
          eq(envelopeAssignments.month, month),
        ));
      if (existing) {
        const [updated] = await tx
          .update(envelopeAssignments)
          .set({
            amount: sql`${envelopeAssignments.amount} + ${delta}::numeric`,
            updatedAt: new Date(),
          })
          .where(eq(envelopeAssignments.id, existing.id))
          .returning();
        return updated!;
      }
      const [created] = await tx
        .insert(envelopeAssignments)
        .values({
          userId: uid,
          categoryId: catId,
          month,
          amount: delta,
        })
        .returning();
      return created!;
    }

    const from = await bumpBy(fromCategoryId, `-${amount}`);
    const to = await bumpBy(toCategoryId, amount);
    return { from, to };
  });

  return reply.code(200).send({
    from: serializeAssignment(result.from),
    to:   serializeAssignment(result.to),
  });
});
```

- [ ] **Step 4: Run tests to verify pass**

Run: `RUN_DB_TESTS=1 npx vitest run backend/tests/envelopes-route.test.ts`
Expected: PASS (all cases including reallocate).

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/http/routes/envelopes.ts \
  backend/tests/envelopes-route.test.ts

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): atomic reallocation between two envelopes"
```

---

## Task 5: Category settings route

**Files:**
- Modify: `backend/src/http/routes/envelopes.ts`
- Modify: `backend/tests/envelopes-route.test.ts`

**Interfaces:**
- Produces:
  ```
  GET    /api/envelopes/categories  → { settings: [{ categoryId, targetAmount?, targetDate?, targetKind?, overspendPolicy }] }
  PUT    /api/envelopes/categories/:categoryId  body { targetAmount?, targetDate?, targetKind?, overspendPolicy? }
  DELETE /api/envelopes/categories/:categoryId  → 204
  ```

- [ ] **Step 1: Failing tests**

Append to `backend/tests/envelopes-route.test.ts`:

```ts
describe.skipIf(!RUN)('/api/envelopes/categories', () => {
  let cat: number;
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'settings-user', password: 'settings-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'settings-user', password: 'settings-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    const c = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Vacances', kind: 'expense' },
    });
    cat = c.json().category.id;
  });

  it('upserts settings for a category', async () => {
    const r = await app.inject({
      method: 'PUT', url: `/api/envelopes/categories/${cat}`, headers: { cookie },
      payload: {
        targetAmount: '1200.00',
        targetDate: '2026-12-01',
        targetKind: 'save_by_date',
        overspendPolicy: 'reallocate_manual',
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().settings.targetAmount).toBe('1200.00');
    expect(r.json().settings.overspendPolicy).toBe('reallocate_manual');
  });

  it('rejects bad targetKind', async () => {
    const r = await app.inject({
      method: 'PUT', url: `/api/envelopes/categories/${cat}`, headers: { cookie },
      payload: { targetKind: 'bogus' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('lists settings for user', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/envelopes/categories', headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().settings).toHaveLength(1);
  });

  it('deletes settings', async () => {
    const r = await app.inject({
      method: 'DELETE', url: `/api/envelopes/categories/${cat}`, headers: { cookie },
    });
    expect(r.statusCode).toBe(204);
    const list = await app.inject({
      method: 'GET', url: '/api/envelopes/categories', headers: { cookie },
    });
    expect(list.json().settings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to see failures**

Run: `RUN_DB_TESTS=1 npx vitest run backend/tests/envelopes-route.test.ts`

- [ ] **Step 3: Implement handlers**

In `backend/src/http/routes/envelopes.ts`, add these imports at the top with the other schema import:

```ts
import { envelopeCategorySettings } from '../../db/schema.js';
```

Inside `envelopesRoutes(app)`, after the reallocate handler:

```ts
function serializeSettings(row: typeof envelopeCategorySettings.$inferSelect) {
  return {
    categoryId: row.categoryId,
    targetAmount: row.targetAmount,
    targetDate: row.targetDate,
    targetKind: row.targetKind,
    overspendPolicy: row.overspendPolicy,
  };
}

app.get('/api/envelopes/categories', async (req) => {
  const uid = userId(req);
  const rows = await db
    .select()
    .from(envelopeCategorySettings)
    .where(eq(envelopeCategorySettings.userId, uid))
    .orderBy(asc(envelopeCategorySettings.categoryId));
  return { settings: rows.map(serializeSettings) };
});

const SettingsPutBody = z.object({
  targetAmount: signedDecimal.nullable().optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  targetKind: z.enum(['save_by_date', 'monthly_recurring', 'save_up_to']).nullable().optional(),
  overspendPolicy: z.enum(['rollover_negative', 'reallocate_manual']).optional(),
});
const SettingsCatIdParam = z.object({ categoryId: z.coerce.number().int().positive() });

app.put('/api/envelopes/categories/:categoryId', async (req, reply) => {
  const uid = userId(req);
  const idP = SettingsCatIdParam.safeParse(req.params);
  if (!idP.success) return reply.code(400).send({ error: 'invalid id' });
  const parsed = SettingsPutBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
  }
  if (!(await expenseCategoryOwned(uid, idP.data.categoryId))) {
    return reply.code(400).send({ error: 'category_not_expense' });
  }
  const values = {
    userId: uid,
    categoryId: idP.data.categoryId,
    targetAmount: parsed.data.targetAmount ?? null,
    targetDate: parsed.data.targetDate ?? null,
    targetKind: parsed.data.targetKind ?? null,
    overspendPolicy: parsed.data.overspendPolicy ?? 'rollover_negative',
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(envelopeCategorySettings)
    .values(values)
    .onConflictDoUpdate({
      target: [envelopeCategorySettings.userId, envelopeCategorySettings.categoryId],
      set: {
        targetAmount: values.targetAmount,
        targetDate: values.targetDate,
        targetKind: values.targetKind,
        overspendPolicy: values.overspendPolicy,
        updatedAt: values.updatedAt,
      },
    })
    .returning();
  return { settings: serializeSettings(row!) };
});

app.delete('/api/envelopes/categories/:categoryId', async (req, reply) => {
  const uid = userId(req);
  const idP = SettingsCatIdParam.safeParse(req.params);
  if (!idP.success) return reply.code(400).send({ error: 'invalid id' });
  const [deleted] = await db
    .delete(envelopeCategorySettings)
    .where(and(
      eq(envelopeCategorySettings.userId, uid),
      eq(envelopeCategorySettings.categoryId, idP.data.categoryId),
    ))
    .returning({ categoryId: envelopeCategorySettings.categoryId });
  if (!deleted) return reply.code(404).send({ error: 'not found' });
  return reply.code(204).send();
});
```

- [ ] **Step 4: Run tests to verify pass**

Run: `RUN_DB_TESTS=1 npx vitest run backend/tests/envelopes-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/http/routes/envelopes.ts \
  backend/tests/envelopes-route.test.ts

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): per-envelope target + overspend policy route"
```

---

## Task 6: Month holds route

**Files:**
- Modify: `backend/src/http/routes/envelopes.ts`
- Modify: `backend/tests/envelopes-route.test.ts`

**Interfaces:**
- Produces:
  ```
  GET /api/envelopes/holds?from=YYYY-MM&to=YYYY-MM  → { holds: [{ month, amount }] }
  PUT /api/envelopes/holds  body { month: "YYYY-MM", amount }  amount=0 deletes.
  ```

- [ ] **Step 1: Failing tests**

Append to `backend/tests/envelopes-route.test.ts`:

```ts
describe.skipIf(!RUN)('/api/envelopes/holds', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'holds-user', password: 'holds-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'holds-user', password: 'holds-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  it('creates a hold', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/envelopes/holds', headers: { cookie },
      payload: { month: '2026-07', amount: '500.00' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().hold.amount).toBe('500.00');
    expect(r.json().hold.month).toBe('2026-07');
  });

  it('lists holds in a range', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/envelopes/holds?from=2026-01&to=2026-12',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().holds).toHaveLength(1);
  });

  it('deletes hold when amount = 0', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/envelopes/holds', headers: { cookie },
      payload: { month: '2026-07', amount: '0.00' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().deleted).toBe(true);
    const list = await app.inject({
      method: 'GET', url: '/api/envelopes/holds?from=2026-01&to=2026-12',
      headers: { cookie },
    });
    expect(list.json().holds).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to see failures**

Run: `RUN_DB_TESTS=1 npx vitest run backend/tests/envelopes-route.test.ts`

- [ ] **Step 3: Implement**

In `backend/src/http/routes/envelopes.ts`, add import:

```ts
import { envelopeMonthHolds } from '../../db/schema.js';
```

Inside `envelopesRoutes(app)`:

```ts
const HoldsQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}$/).transform((s) => `${s}-01`),
  to:   z.string().regex(/^\d{4}-\d{2}$/).transform((s) => `${s}-01`),
});
app.get('/api/envelopes/holds', async (req, reply) => {
  const uid = userId(req);
  const parsed = HoldsQuery.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid range' });
  const rows = await db
    .select()
    .from(envelopeMonthHolds)
    .where(and(
      eq(envelopeMonthHolds.userId, uid),
      gte(envelopeMonthHolds.month, parsed.data.from),
      lte(envelopeMonthHolds.month, parsed.data.to),
    ))
    .orderBy(asc(envelopeMonthHolds.month));
  return { holds: rows.map((r) => ({ month: r.month, amount: r.amount })) };
});

const HoldPutBody = z.object({
  month: monthStr,
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'must be a non-negative decimal'),
});
app.put('/api/envelopes/holds', async (req, reply) => {
  const uid = userId(req);
  const parsed = HoldPutBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
  }
  const { month, amount } = parsed.data;
  if (Number(amount) === 0) {
    await db
      .delete(envelopeMonthHolds)
      .where(and(eq(envelopeMonthHolds.userId, uid), eq(envelopeMonthHolds.month, month)));
    return { deleted: true };
  }
  const [row] = await db
    .insert(envelopeMonthHolds)
    .values({ userId: uid, month, amount })
    .onConflictDoUpdate({
      target: [envelopeMonthHolds.userId, envelopeMonthHolds.month],
      set: { amount, updatedAt: new Date() },
    })
    .returning();
  return { hold: { month: row!.month, amount: row!.amount } };
});
```

- [ ] **Step 4: Run tests to verify pass**

Run: `RUN_DB_TESTS=1 npx vitest run backend/tests/envelopes-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/http/routes/envelopes.ts \
  backend/tests/envelopes-route.test.ts

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): month-ahead hold route (PUT/GET, 0 deletes)"
```

---

## Task 7: Report endpoint

**Files:**
- Modify: `backend/src/http/routes/envelopes.ts`
- Modify: `backend/tests/envelopes-route.test.ts`

**Interfaces:**
- Consumes: `envelopeAssignments`, `envelopeCategorySettings`, `envelopeMonthHolds`, `transactions`, `categories`, `computeCategoryBalances`, `computePool` from `envelope-math`.
- Produces: `GET /api/envelopes/report?month=YYYY-MM` → `EnvelopeReport` shape from spec.

- [ ] **Step 1: Write failing test scaffolds**

Append to `backend/tests/envelopes-route.test.ts`:

```ts
describe.skipIf(!RUN)('GET /api/envelopes/report', () => {
  let expA: number;
  let incC: number;
  let acct: number;
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'report-user', password: 'report-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'report-user', password: 'report-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    const a = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Alimentation', kind: 'expense' },
    });
    expA = a.json().category.id;
    const inc = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Salaire', kind: 'income' },
    });
    incC = inc.json().category.id;
    const ac = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'Compte', type: 'checking', currency: 'EUR', openingBalance: '0', openingDate: '2026-01-01' },
    });
    acct = ac.json().account.id;
    // Income of 1000 in June, spend of 200 in June under Alimentation.
    await app.inject({
      method: 'POST', url: '/api/transactions', headers: { cookie },
      payload: {
        accountId: acct, date: '2026-06-01', amount: '1000.00',
        rawLabel: 'Salaire', normalizedLabel: 'salaire',
        categoryId: incC, dedupKey: 'inc-1',
      },
    });
    await app.inject({
      method: 'POST', url: '/api/transactions', headers: { cookie },
      payload: {
        accountId: acct, date: '2026-06-15', amount: '-200.00',
        rawLabel: 'Courses', normalizedLabel: 'courses',
        categoryId: expA, dedupKey: 'sp-1',
      },
    });
    // Assign 300 in June under Alimentation
    await app.inject({
      method: 'PUT', url: '/api/envelopes/assignments', headers: { cookie },
      payload: { categoryId: expA, month: '2026-06', amount: '300.00' },
    });
  });

  it('returns pool + rows for the requested month', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/envelopes/report?month=2026-06',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.month).toBe('2026-06');
    expect(body.pool.incomeCumulative).toBe('1000.00');
    expect(body.pool.assignedCumulative).toBe('300.00');
    expect(body.pool.available).toBe('700.00');
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].categoryId).toBe(expA);
    expect(body.rows[0].assignment).toBe('300.00');
    expect(body.rows[0].spend).toBe('200.00');
    expect(body.rows[0].balance).toBe('100.00');
    expect(body.rows[0].overspent).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `RUN_DB_TESTS=1 npx vitest run backend/tests/envelopes-route.test.ts -t "report"`
Expected: FAIL — 404.

- [ ] **Step 3: Implement the report handler**

Add to imports in `backend/src/http/routes/envelopes.ts`:

```ts
import { transactions } from '../../db/schema.js';
import { computeCategoryBalances, computePool } from '../../lib/envelope-math.js';
```

Inside `envelopesRoutes(app)`:

```ts
const ReportQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

app.get('/api/envelopes/report', async (req, reply) => {
  const uid = userId(req);
  const parsed = ReportQuery.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid month' });
  const monthYm = parsed.data.month;
  const monthDate = `${monthYm}-01`;

  // 1) Assignments up to & including this month
  const asgnRows = await db
    .select()
    .from(envelopeAssignments)
    .where(and(
      eq(envelopeAssignments.userId, uid),
      lte(envelopeAssignments.month, monthDate),
    ));

  // 2) Spend by (category, month) up to this month for the user's expense categories
  const spendRows = await db
    .select({
      categoryId: transactions.categoryId,
      month: sql<string>`to_char(date_trunc('month', ${transactions.date}), 'YYYY-MM-01')`,
      amount: sql<string>`sum(abs(${transactions.amount}))::text`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(
      eq(categories.userId, uid),
      eq(categories.kind, 'expense'),
      lte(transactions.date, sql`(${monthDate}::date + interval '1 month - 1 day')`),
    ))
    .groupBy(transactions.categoryId, sql`date_trunc('month', ${transactions.date})`);

  // 3) Income cumulative up to this month
  const [incomeAgg] = await db
    .select({
      total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(
      eq(categories.userId, uid),
      eq(categories.kind, 'income'),
      lte(transactions.date, sql`(${monthDate}::date + interval '1 month - 1 day')`),
    ));

  // 4) Holds: this month + prior month
  const priorDate = sql<string>`(${monthDate}::date - interval '1 month')::date`;
  const holdRows = await db
    .select()
    .from(envelopeMonthHolds)
    .where(and(
      eq(envelopeMonthHolds.userId, uid),
      sql`${envelopeMonthHolds.month} in (${monthDate}::date, (${monthDate}::date - interval '1 month')::date)`,
    ));
  const holdThis = holdRows.find((h) => h.month === monthDate)?.amount ?? '0.00';
  const holdPrev = holdRows.find((h) => h.month !== monthDate)?.amount ?? '0.00';

  // 5) Settings (target + policy)
  const settingsRows = await db
    .select()
    .from(envelopeCategorySettings)
    .where(eq(envelopeCategorySettings.userId, uid));
  const settingsBy = new Map(settingsRows.map((s) => [s.categoryId, s]));

  // 6) Category names for the union of {envelope categories, spend categories}
  const catIds = new Set<number>([
    ...asgnRows.map((a) => a.categoryId),
    ...spendRows.map((s) => s.categoryId).filter((x): x is number => x != null),
  ]);
  const catRows = catIds.size
    ? await db.select().from(categories).where(and(
        eq(categories.userId, uid),
        sql`${categories.id} = ANY(${sql.raw('ARRAY[' + [...catIds].join(',') + ']')}::int[])`,
      ))
    : [];
  const nameBy = new Map(catRows.map((c) => [c.id, c.name]));

  // 7) Balance fold via envelope-math
  const balances = computeCategoryBalances(
    monthDate,
    asgnRows.map((a) => ({ categoryId: a.categoryId, month: a.month, amount: a.amount })),
    spendRows
      .filter((s): s is typeof s & { categoryId: number } => s.categoryId != null)
      .map((s) => ({ categoryId: s.categoryId, month: s.month, amount: s.amount })),
    settingsRows.map((s) => ({ categoryId: s.categoryId, overspendPolicy: s.overspendPolicy as 'rollover_negative' | 'reallocate_manual' })),
  );

  // 8) Prior-month total absorbed (for pool subtract)
  const priorBalances = computeCategoryBalances(
    // upToMonth = M-1 first-of-month
    // Compute via date_trunc-like string math on JS side:
    (() => {
      const [y, m] = monthYm.split('-').map(Number);
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return `${py}-${String(pm).padStart(2, '0')}-01`;
    })(),
    asgnRows.map((a) => ({ categoryId: a.categoryId, month: a.month, amount: a.amount })),
    spendRows
      .filter((s): s is typeof s & { categoryId: number } => s.categoryId != null)
      .map((s) => ({ categoryId: s.categoryId, month: s.month, amount: s.amount })),
    settingsRows.map((s) => ({ categoryId: s.categoryId, overspendPolicy: s.overspendPolicy as 'rollover_negative' | 'reallocate_manual' })),
  );
  const totalAbsorbedPrior = [...priorBalances.values()]
    .reduce((sum, b) => sum + Number(b.absorbedByPool), 0)
    .toFixed(2);

  const assignedCumul = asgnRows.reduce((sum, a) => sum + Number(a.amount), 0).toFixed(2);
  const pool = computePool({
    upToMonth: monthDate,
    incomeCumulative: incomeAgg?.total ?? '0.00',
    assignmentCumulative: assignedCumul,
    holdThisMonth: holdThis,
    holdPriorMonth: holdPrev,
    totalAbsorbedPriorMonth: totalAbsorbedPrior,
  });

  // 9) Assemble rows for the requested month
  const rows = [...catIds].map((catId) => {
    const b = balances.get(catId) ?? { balance: '0.00', absorbedByPool: '0.00', overspent: false };
    const priorB = priorBalances.get(catId)?.balance ?? '0.00';
    const asgnThis = asgnRows
      .filter((a) => a.categoryId === catId && a.month === monthDate)
      .reduce((s, a) => s + Number(a.amount), 0).toFixed(2);
    const spendThis = spendRows
      .filter((s) => s.categoryId === catId && s.month === monthDate)
      .reduce((s, r) => s + Number(r.amount), 0).toFixed(2);
    const settings = settingsBy.get(catId);
    return {
      categoryId: catId,
      categoryName: nameBy.get(catId) ?? '',
      balancePriorMonth: priorB,
      assignment: asgnThis,
      spend: spendThis,
      balance: b.balance,
      target: settings?.targetAmount
        ? { amount: settings.targetAmount, date: settings.targetDate, kind: settings.targetKind! }
        : null,
      overspendPolicy: (settings?.overspendPolicy ?? 'rollover_negative') as
        'rollover_negative' | 'reallocate_manual',
      overspent: b.overspent,
      absorbedByPool: b.absorbedByPool,
      monthsToTarget: null as number | null,   // deferred; UI computes if desired
    };
  });

  return {
    month: monthYm,
    pool: {
      incomeCumulative: incomeAgg?.total ?? '0.00',
      assignedCumulative: assignedCumul,
      heldFromPriorMonths: pool.heldFromPriorMonths,
      heldForNextMonth: pool.heldForNextMonth,
      available: pool.available,
    },
    rows,
  };
});
```

- [ ] **Step 4: Run tests to verify pass**

Run: `RUN_DB_TESTS=1 npx vitest run backend/tests/envelopes-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/http/routes/envelopes.ts \
  backend/tests/envelopes-route.test.ts

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): report endpoint (pool + per-envelope rows)"
```

---

## Task 8: Nav restructure + `/budgets` redirect + rename `Budgets.tsx` → `Plafonds.tsx`

**Files:**
- Modify: `frontend/src/components/Layout.tsx` (Budgets item → hub with two children)
- Modify: `frontend/src/App.tsx` (routes: `/budgets` redirect, `/budgets/plafonds`, `/budgets/enveloppes` placeholder)
- Rename (`git mv`): `frontend/src/pages/Budgets/Budgets.tsx` → `frontend/src/pages/Budgets/Plafonds.tsx`
- Update any imports: `frontend/src/App.tsx`, `frontend/src/pages/Budgets/index.ts` (if it exists), `frontend/src/pages/__tests__/Budgets.test.tsx` → renamed to `Plafonds.test.tsx`
- Modify: `frontend/src/components/__tests__/Layout.test.tsx` (nav must show hub + children)
- Modify: `frontend/src/pages/__tests__/redirects.test.tsx` (old `/budgets` → `/budgets/plafonds`)

**Interfaces:**
- Produces: routes `/budgets/plafonds` (current behaviour) and `/budgets/enveloppes` (placeholder "Enveloppes — bientôt" for now); redirects `/budgets → /budgets/plafonds`.

- [ ] **Step 1: Failing test — nav renders both children when the hub is active**

Update `frontend/src/components/__tests__/Layout.test.tsx` — find the labels array and update; add a new test:

```ts
it('renders Budgets hub with Plafonds + Enveloppes children when on /budgets/*', async () => {
  render(<MemoryRouter initialEntries={['/budgets/plafonds']}><Layout user={fakeUser} /></MemoryRouter>);
  expect(await screen.findByText('Budgets')).toBeInTheDocument();
  expect(await screen.findByText('Plafonds')).toBeInTheDocument();
  expect(await screen.findByText('Enveloppes')).toBeInTheDocument();
});
```

Also update the existing labels array test to replace `'Budgets'` alone with the parent+children set (Budgets, Plafonds, Enveloppes should all appear when active).

- [ ] **Step 2: Failing test — `/budgets` redirects to `/budgets/plafonds`**

Add to `frontend/src/pages/__tests__/redirects.test.tsx`:

```ts
it('/budgets redirects to /budgets/plafonds', async () => {
  vi.mock('../../pages/Budgets/Plafonds', () => ({ Plafonds: () => <div>plafonds-page</div> }));
  render(<MemoryRouter initialEntries={['/budgets']}><App /></MemoryRouter>);
  expect(await screen.findByText('plafonds-page')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to see failures**

Run: `npm --prefix frontend run test -- Layout.test redirects.test`
Expected: FAIL — hub structure not there, redirect missing.

- [ ] **Step 4: Restructure the nav item in `Layout.tsx`**

At `frontend/src/components/Layout.tsx:26`, replace:

```ts
{ to: '/budgets', label: 'Budgets', icon: 'budgets' },
```

with:

```ts
{
  to: '/budgets',
  label: 'Budgets',
  icon: 'budgets',
  children: [
    { to: '/budgets/plafonds', label: 'Plafonds' },
    { to: '/budgets/enveloppes', label: 'Enveloppes' },
  ],
},
```

- [ ] **Step 5: Rename the page file**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com mv \
  frontend/src/pages/Budgets/Budgets.tsx frontend/src/pages/Budgets/Plafonds.tsx

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com mv \
  frontend/src/pages/__tests__/Budgets.test.tsx frontend/src/pages/__tests__/Plafonds.test.tsx
```

Inside the renamed files, replace the exported identifier `Budgets` with `Plafonds` (search-and-replace within the two files only) and update the imports in `frontend/src/pages/__tests__/Plafonds.test.tsx` to match.

- [ ] **Step 6: Update `App.tsx` routes**

At `frontend/src/App.tsx:13`, change:

```ts
import { Budgets } from './pages/Budgets';
```

to:

```ts
import { Plafonds } from './pages/Budgets/Plafonds';
```

Replace the single `<Route path="/budgets" element={<Budgets />} />` (around line 97) with:

```tsx
<Route path="/budgets" element={<Navigate to="/budgets/plafonds" replace />} />
<Route path="/budgets/plafonds" element={<Plafonds />} />
<Route path="/budgets/enveloppes" element={<EnveloppesPlaceholder />} />
```

Above the `export` for the App component, add:

```tsx
function EnveloppesPlaceholder() {
  return <div className="surface p-6 text-ink-300">Enveloppes — bientôt.</div>;
}
```

Ensure `Navigate` is imported from `react-router-dom`.

- [ ] **Step 7: Run tests to verify pass**

Run: `npm --prefix frontend run test -- Layout.test redirects.test Plafonds.test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/components/Layout.tsx \
  frontend/src/components/__tests__/Layout.test.tsx \
  frontend/src/App.tsx \
  frontend/src/pages/Budgets/Plafonds.tsx \
  frontend/src/pages/__tests__/Plafonds.test.tsx \
  frontend/src/pages/__tests__/redirects.test.tsx

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "refactor(nav): Budgets becomes a hub — Plafonds + Enveloppes"
```

---

## Task 9: Frontend types + `useEnvelopes` hooks

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/lib/useEnvelopes.ts`
- Create: `frontend/src/lib/__tests__/useEnvelopes.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type TargetKind = 'save_by_date' | 'monthly_recurring' | 'save_up_to';
  export type OverspendPolicy = 'rollover_negative' | 'reallocate_manual';
  export interface EnvelopeAssignment { id: number; categoryId: number; month: string; amount: string; currency: string }
  export interface EnvelopeCategorySettings { categoryId: number; targetAmount: string | null; targetDate: string | null; targetKind: TargetKind | null; overspendPolicy: OverspendPolicy }
  export interface EnvelopeHold { month: string; amount: string }
  export interface EnvelopeReportRow { categoryId: number; categoryName: string; balancePriorMonth: string; assignment: string; spend: string; balance: string; target: { amount: string; date: string | null; kind: TargetKind } | null; overspendPolicy: OverspendPolicy; overspent: boolean; absorbedByPool: string; monthsToTarget: number | null }
  export interface EnvelopeReport { month: string; pool: { incomeCumulative: string; assignedCumulative: string; heldFromPriorMonths: string; heldForNextMonth: string; available: string }; rows: EnvelopeReportRow[] }
  ```
  Plus hooks: `useEnvelopeReport(month)`, `useUpsertAssignment()`, `useReallocate()`, `useUpsertHold()`, `useEnvelopeSettings()`, `useUpsertSettings()`, `useDeleteSettings()`.

- [ ] **Step 1: Add types**

At the end of `frontend/src/api/types.ts`, append the types block above verbatim.

- [ ] **Step 2: Failing test — hook shape**

Create `frontend/src/lib/__tests__/useEnvelopes.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEnvelopeReport } from '../useEnvelopes';

vi.mock('../../api/client', () => ({
  api: vi.fn(),
}));

import { api } from '../../api/client';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useEnvelopeReport', () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it('fetches the report for a given month', async () => {
    vi.mocked(api).mockResolvedValue({ month: '2026-07', pool: { available: '100.00' }, rows: [] });
    const { result } = renderHook(() => useEnvelopeReport('2026-07'), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(vi.mocked(api)).toHaveBeenCalledWith('/api/envelopes/report', { query: { month: '2026-07' } });
    expect(result.current.data!.pool.available).toBe('100.00');
  });
});
```

- [ ] **Step 3: Run to see failure**

Run: `npm --prefix frontend run test -- useEnvelopes.test`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `useEnvelopes.ts`**

Create `frontend/src/lib/useEnvelopes.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  EnvelopeAssignment, EnvelopeCategorySettings, EnvelopeHold, EnvelopeReport,
  OverspendPolicy, TargetKind,
} from '../api/types';

const KEY_REPORT = (month: string) => ['envelopes', 'report', month] as const;
const KEY_SETTINGS = ['envelopes', 'settings'] as const;
const KEY_HOLDS = (from: string, to: string) => ['envelopes', 'holds', { from, to }] as const;

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['envelopes'] });
}

export function useEnvelopeReport(month: string) {
  return useQuery({
    queryKey: KEY_REPORT(month),
    queryFn: () => api<EnvelopeReport>('/api/envelopes/report', { query: { month } }),
  });
}

export function useEnvelopeSettings() {
  return useQuery({
    queryKey: KEY_SETTINGS,
    queryFn: () => api<{ settings: EnvelopeCategorySettings[] }>('/api/envelopes/categories'),
  });
}

export function useUpsertAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { categoryId: number; month: string; amount: string; currency?: string }) =>
      api<{ assignment: EnvelopeAssignment }>('/api/envelopes/assignments', {
        method: 'PUT', body,
      }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useReallocate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { fromCategoryId: number; toCategoryId: number; month: string; amount: string }) =>
      api<{ from: EnvelopeAssignment; to: EnvelopeAssignment }>('/api/envelopes/reallocate', {
        method: 'POST', body,
      }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpsertHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { month: string; amount: string }) =>
      api<{ hold?: EnvelopeHold; deleted?: true }>('/api/envelopes/holds', {
        method: 'PUT', body,
      }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpsertSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { categoryId: number; body: { targetAmount?: string | null; targetDate?: string | null; targetKind?: TargetKind | null; overspendPolicy?: OverspendPolicy } }) =>
      api<{ settings: EnvelopeCategorySettings }>(`/api/envelopes/categories/${args.categoryId}`, {
        method: 'PUT', body: args.body,
      }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: number) =>
      api<void>(`/api/envelopes/categories/${categoryId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useHolds(from: string, to: string) {
  return useQuery({
    queryKey: KEY_HOLDS(from, to),
    queryFn: () => api<{ holds: EnvelopeHold[] }>('/api/envelopes/holds', { query: { from, to } }),
  });
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm --prefix frontend run test -- useEnvelopes.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/api/types.ts \
  frontend/src/lib/useEnvelopes.ts \
  frontend/src/lib/__tests__/useEnvelopes.test.tsx

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): frontend types + TanStack Query hooks"
```

---

## Task 10: Client envelope-math + PoolCard + EnvelopeRow (read-only)

**Files:**
- Create: `frontend/src/pages/Budgets/envelope-math.ts`
- Create: `frontend/src/pages/Budgets/__tests__/envelope-math.test.ts`
- Create: `frontend/src/pages/Budgets/Enveloppes/PoolCard.tsx`
- Create: `frontend/src/pages/Budgets/Enveloppes/EnvelopeRow.tsx`
- Create: `frontend/src/pages/Budgets/Enveloppes/__tests__/PoolCard.test.tsx`
- Create: `frontend/src/pages/Budgets/Enveloppes/__tests__/EnvelopeRow.test.tsx`

**Interfaces:**
- Produces: `formatSignedMoney(m: string): string`; `PoolCard` (props: `pool: EnvelopeReport['pool']`, `onHoldClick: () => void`); `EnvelopeRow` (props: `row: EnvelopeReportRow`, `onReallocateClick`, `onSettingsClick`, `assignmentSlot: React.ReactNode`).

- [ ] **Step 1: Failing test — signed money format**

Create `frontend/src/pages/Budgets/__tests__/envelope-math.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatSignedMoney, computeTargetProgress } from '../envelope-math';

describe('formatSignedMoney', () => {
  it('formats positive with regular sign', () => {
    expect(formatSignedMoney('12.50')).toBe('12,50 €');
  });
  it('keeps the minus for negatives', () => {
    expect(formatSignedMoney('-65.00')).toBe('−65,00 €'); // U+2212 en dash for minus
  });
});

describe('computeTargetProgress', () => {
  it('returns null when no target', () => {
    expect(computeTargetProgress({ target: null, balance: '10.00', assignment: '0.00' })).toBeNull();
  });
  it('save_by_date uses balance / amount', () => {
    expect(computeTargetProgress({
      target: { amount: '1200.00', date: '2026-12-01', kind: 'save_by_date' },
      balance: '700.00', assignment: '100.00',
    })!.pct).toBeCloseTo(700 / 1200, 3);
  });
  it('monthly_recurring uses assignment / amount', () => {
    expect(computeTargetProgress({
      target: { amount: '500.00', date: null, kind: 'monthly_recurring' },
      balance: '0.00', assignment: '450.00',
    })!.pct).toBeCloseTo(450 / 500, 3);
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --prefix frontend run test -- envelope-math.test`
Expected: FAIL.

- [ ] **Step 3: Implement `envelope-math.ts`**

Create `frontend/src/pages/Budgets/envelope-math.ts`:

```ts
import type { EnvelopeReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';

export function formatSignedMoney(m: string): string {
  const n = Number(m);
  if (n < 0) return '−' + formatAmount(String(-n));
  return formatAmount(m);
}

export function computeTargetProgress(
  row: Pick<EnvelopeReportRow, 'target' | 'balance' | 'assignment'>,
): { pct: number; label: string } | null {
  if (!row.target) return null;
  const amount = Number(row.target.amount);
  if (amount <= 0) return null;
  const bal = Number(row.balance);
  const asg = Number(row.assignment);
  let pct = 0;
  let label = '';
  if (row.target.kind === 'monthly_recurring') {
    pct = asg / amount;
    label = `Objectif: ${formatAmount(row.target.amount)}/mois`;
  } else if (row.target.kind === 'save_by_date') {
    pct = bal / amount;
    label = `Objectif: ${formatAmount(row.target.amount)} d'ici ${row.target.date ?? '—'}`;
  } else {
    pct = bal / amount;
    label = `Objectif: ${formatAmount(row.target.amount)}`;
  }
  return { pct: Math.max(0, Math.min(1, pct)), label };
}
```

- [ ] **Step 4: Run math tests to verify pass**

Run: `npm --prefix frontend run test -- envelope-math.test`
Expected: PASS.

- [ ] **Step 5: Write failing PoolCard/EnvelopeRow tests**

Create `frontend/src/pages/Budgets/Enveloppes/__tests__/PoolCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PoolCard } from '../PoolCard';

const pool = {
  incomeCumulative: '18400.00',
  assignedCumulative: '16900.00',
  heldFromPriorMonths: '500.00',
  heldForNextMonth: '0.00',
  available: '1240.00',
};

describe('PoolCard', () => {
  it('renders the headline available amount', () => {
    render(<PoolCard pool={pool} onHoldClick={vi.fn()} />);
    expect(screen.getByText('1 240,00 €')).toBeInTheDocument();
  });

  it('shows red when available < 0', () => {
    render(<PoolCard pool={{ ...pool, available: '-50.00' }} onHoldClick={vi.fn()} />);
    expect(screen.getByText('−50,00 €')).toHaveClass('text-clay-300');
  });

  it('fires onHoldClick when the Retenir button is pressed', () => {
    const spy = vi.fn();
    render(<PoolCard pool={pool} onHoldClick={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /Retenir/i }));
    expect(spy).toHaveBeenCalled();
  });
});
```

Create `frontend/src/pages/Budgets/Enveloppes/__tests__/EnvelopeRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnvelopeRow } from '../EnvelopeRow';

const row = {
  categoryId: 1, categoryName: 'Alimentation',
  balancePriorMonth: '80.00', assignment: '450.00',
  spend: '510.00', balance: '20.00',
  target: null, overspendPolicy: 'rollover_negative' as const,
  overspent: false, absorbedByPool: '0.00', monthsToTarget: null,
};

describe('EnvelopeRow', () => {
  it('renders name, prev, spend, balance', () => {
    render(<EnvelopeRow row={row} onReallocateClick={vi.fn()} onSettingsClick={vi.fn()} assignmentSlot={<span>slot</span>} />);
    expect(screen.getByText('Alimentation')).toBeInTheDocument();
    expect(screen.getByText('80,00 €')).toBeInTheDocument();
    expect(screen.getByText('510,00 €')).toBeInTheDocument();
    expect(screen.getByText('20,00 €')).toBeInTheDocument();
  });

  it('shows absorbé chip when overspent under reallocate_manual', () => {
    render(<EnvelopeRow
      row={{ ...row, overspendPolicy: 'reallocate_manual', overspent: true, balance: '0.00', absorbedByPool: '65.00' }}
      onReallocateClick={vi.fn()} onSettingsClick={vi.fn()} assignmentSlot={<span />}
    />);
    expect(screen.getByText(/absorbé/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Implement PoolCard**

Create `frontend/src/pages/Budgets/Enveloppes/PoolCard.tsx`:

```tsx
import type { EnvelopeReport } from '../../../api/types';
import { formatAmount } from '../../../lib/format';
import { formatSignedMoney } from '../envelope-math';

export function PoolCard(props: {
  pool: EnvelopeReport['pool'];
  onHoldClick: () => void;
}): JSX.Element {
  const negative = Number(props.pool.available) < 0;
  return (
    <div className="surface p-6 flex flex-col gap-3">
      <div className="label">À budgétiser (pool)</div>
      <div className={`display text-4xl ${negative ? 'text-clay-300' : 'text-ink-50'}`}>
        {formatSignedMoney(props.pool.available)}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-ink-400 mt-2">
        <dt>Revenus (cumulé)</dt>
        <dd className="text-right">{formatAmount(props.pool.incomeCumulative)}</dd>
        <dt>Assigné (cumulé)</dt>
        <dd className="text-right">{formatAmount(props.pool.assignedCumulative)}</dd>
        <dt>Reçu du mois dernier</dt>
        <dd className="text-right">{formatAmount(props.pool.heldFromPriorMonths)}</dd>
        <dt>Retenu pour le mois prochain</dt>
        <dd className="text-right flex items-center justify-end gap-2">
          <span>{formatAmount(props.pool.heldForNextMonth)}</span>
          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={props.onHoldClick}>
            Retenir…
          </button>
        </dd>
      </dl>
    </div>
  );
}
```

- [ ] **Step 7: Implement EnvelopeRow**

Create `frontend/src/pages/Budgets/Enveloppes/EnvelopeRow.tsx`:

```tsx
import type { EnvelopeReportRow } from '../../../api/types';
import { formatAmount } from '../../../lib/format';
import { formatSignedMoney, computeTargetProgress } from '../envelope-math';

export function EnvelopeRow(props: {
  row: EnvelopeReportRow;
  assignmentSlot: React.ReactNode;
  onReallocateClick: (row: EnvelopeReportRow) => void;
  onSettingsClick: (row: EnvelopeReportRow) => void;
}): JSX.Element {
  const { row } = props;
  const progress = computeTargetProgress(row);
  const balanceNegative = Number(row.balance) < 0;
  const absorbed = row.overspendPolicy === 'reallocate_manual' && Number(row.absorbedByPool) > 0;
  return (
    <div className="surface p-4 flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_80px_120px_100px_100px_40px] items-center gap-3 text-sm">
        <div className="text-ink-50 font-medium truncate">{row.categoryName}</div>
        <div className="text-ink-400 text-right">{formatAmount(row.balancePriorMonth)}</div>
        <div>{props.assignmentSlot}</div>
        <div className="text-ink-400 text-right">{formatAmount(row.spend)}</div>
        <div className={`text-right ${balanceNegative ? 'text-clay-300' : 'text-sage-300'}`}>
          {absorbed
            ? <span className="text-clay-300">⚠ absorbé</span>
            : formatSignedMoney(row.balance)}
        </div>
        <div className="flex justify-end gap-1">
          <button
            aria-label="Réaffecter"
            className="btn-ghost !py-1 !px-1.5 text-xs"
            onClick={() => props.onReallocateClick(row)}
          >→</button>
          <button
            aria-label="Réglages"
            className="btn-ghost !py-1 !px-1.5 text-xs"
            onClick={() => props.onSettingsClick(row)}
          >⋯</button>
        </div>
      </div>
      {progress && (
        <div className="flex items-center gap-2 text-xs text-ink-400">
          <div className="flex-1 h-1.5 bg-ink-800 rounded">
            <div
              className="h-full bg-sage-500 rounded"
              style={{ width: `${(progress.pct * 100).toFixed(0)}%` }}
            />
          </div>
          <span>{progress.label}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run all frontend tests for this task**

Run: `npm --prefix frontend run test -- envelope-math PoolCard EnvelopeRow`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Budgets/envelope-math.ts \
  frontend/src/pages/Budgets/__tests__/envelope-math.test.ts \
  frontend/src/pages/Budgets/Enveloppes/PoolCard.tsx \
  frontend/src/pages/Budgets/Enveloppes/EnvelopeRow.tsx \
  frontend/src/pages/Budgets/Enveloppes/__tests__/PoolCard.test.tsx \
  frontend/src/pages/Budgets/Enveloppes/__tests__/EnvelopeRow.test.tsx

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): PoolCard + EnvelopeRow presentational components"
```

---

## Task 11: Enveloppes page + month navigation + inline assignment editing

**Files:**
- Create: `frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx`
- Create: `frontend/src/pages/Budgets/Enveloppes/AssignmentInput.tsx`
- Create: `frontend/src/pages/Budgets/Enveloppes/__tests__/Enveloppes.test.tsx`
- Modify: `frontend/src/App.tsx` — swap the `EnveloppesPlaceholder` element for `<Enveloppes />` and remove the placeholder function.

**Interfaces:**
- Consumes: `useEnvelopeReport`, `useUpsertAssignment`, `PoolCard`, `EnvelopeRow`.
- Produces: routed page `<Enveloppes />` supporting `?month=YYYY-MM` deep-linking and inline editing.

- [ ] **Step 1: Failing test — loads report, edits assignment**

Create `frontend/src/pages/Budgets/Enveloppes/__tests__/Enveloppes.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Enveloppes } from '../Enveloppes';

vi.mock('../../../../api/client', () => ({ api: vi.fn() }));
import { api } from '../../../../api/client';

const report = {
  month: '2026-07',
  pool: { incomeCumulative: '1000.00', assignedCumulative: '300.00',
          heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '700.00' },
  rows: [{ categoryId: 1, categoryName: 'Alimentation',
           balancePriorMonth: '0.00', assignment: '300.00', spend: '100.00',
           balance: '200.00', target: null,
           overspendPolicy: 'rollover_negative', overspent: false,
           absorbedByPool: '0.00', monthsToTarget: null }],
};

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={['/budgets/enveloppes?month=2026-07']}>
      {children}
    </MemoryRouter>
  </QueryClientProvider>;
}

describe('Enveloppes page', () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it('renders the report and the assignment input', async () => {
    vi.mocked(api).mockImplementation((url: string) => {
      if (url.includes('/report')) return Promise.resolve(report);
      return Promise.resolve({});
    });
    render(wrap(<Enveloppes />));
    expect(await screen.findByText('Alimentation')).toBeInTheDocument();
    expect(screen.getByDisplayValue(/300/)).toBeInTheDocument();
  });

  it('sends PUT /api/envelopes/assignments on blur with new amount', async () => {
    vi.mocked(api).mockImplementation((url: string, opts?: { method?: string; body?: unknown }) => {
      if (opts?.method === 'PUT') return Promise.resolve({ assignment: {} });
      if (url.includes('/report')) return Promise.resolve(report);
      return Promise.resolve({});
    });
    render(wrap(<Enveloppes />));
    const input = await screen.findByDisplayValue(/300/);
    fireEvent.change(input, { target: { value: '400,00' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(vi.mocked(api)).toHaveBeenCalledWith('/api/envelopes/assignments', expect.objectContaining({
        method: 'PUT', body: expect.objectContaining({ categoryId: 1, month: '2026-07', amount: '400.00' }),
      })),
    );
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --prefix frontend run test -- Enveloppes.test`
Expected: FAIL — page missing.

- [ ] **Step 3: Implement `AssignmentInput.tsx`**

Create `frontend/src/pages/Budgets/Enveloppes/AssignmentInput.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { parseDecimal } from '../../../lib/format';

export function AssignmentInput(props: {
  value: string;
  onCommit: (nextAmount: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(props.value.replace('.', ','));
  useEffect(() => { setDraft(props.value.replace('.', ',')); }, [props.value]);

  const commit = () => {
    const parsed = parseDecimal(draft);
    if (parsed == null) return;
    const normalized = parsed.toFixed(2);
    if (normalized !== props.value) props.onCommit(normalized);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className="input !py-1 !px-2 text-right w-full"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}
```

- [ ] **Step 4: Implement `Enveloppes.tsx` (skeleton — modals added in later tasks)**

Create `frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx`:

```tsx
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useEnvelopeReport, useUpsertAssignment } from '../../../lib/useEnvelopes';
import { PoolCard } from './PoolCard';
import { EnvelopeRow } from './EnvelopeRow';
import { AssignmentInput } from './AssignmentInput';

function currentMonthYm(): string {
  // Use client TZ; users see their local month, matching the transactions page.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function stepMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function Enveloppes(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? currentMonthYm();
  const setMonth = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('month', next);
    setParams(p, { replace: true });
  };

  const reportQ = useEnvelopeReport(month);
  const upsertAsg = useUpsertAssignment();

  const rows = reportQ.data?.rows ?? [];
  const pool = reportQ.data?.pool;

  const poolNegative = pool && Number(pool.available) < 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <button className="btn-ghost !py-1 !px-2" onClick={() => setMonth(stepMonth(month, -1))} aria-label="Mois précédent">‹</button>
        <h1 className="display text-2xl">{formatMonthFrench(month)}</h1>
        <button className="btn-ghost !py-1 !px-2" onClick={() => setMonth(stepMonth(month, +1))} aria-label="Mois suivant">›</button>
      </header>

      {poolNegative && (
        <div className="surface p-4 border border-clay-500/60 text-clay-200">
          Vous avez sur-budgété de {formatSignedAbs(pool!.available)}. Réduisez des assignations ou ajoutez des revenus.
        </div>
      )}

      {pool && <PoolCard pool={pool} onHoldClick={() => { /* wired in Task 13 */ }} />}

      <section className="flex flex-col gap-2">
        <div className="label px-2">Enveloppes</div>
        {rows.length === 0 && reportQ.isSuccess && (
          <div className="surface p-6 text-center text-ink-300">
            Aucune enveloppe pour ce mois. Créez votre première enveloppe pour commencer.
          </div>
        )}
        {rows.map((row) => (
          <EnvelopeRow
            key={row.categoryId}
            row={row}
            assignmentSlot={
              <AssignmentInput
                value={row.assignment}
                onCommit={(nextAmount) =>
                  upsertAsg.mutate({ categoryId: row.categoryId, month, amount: nextAmount })
                }
              />
            }
            onReallocateClick={() => { /* wired in Task 12 */ }}
            onSettingsClick={() => { /* wired in Task 14 */ }}
          />
        ))}
      </section>
    </div>
  );
}

function formatMonthFrench(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}
function formatSignedAbs(m: string): string {
  const n = Math.abs(Number(m));
  return n.toFixed(2).replace('.', ',') + ' €';
}
```

- [ ] **Step 5: Wire `<Enveloppes />` into the router**

In `frontend/src/App.tsx`, remove `EnveloppesPlaceholder` and its route element; add:

```ts
import { Enveloppes } from './pages/Budgets/Enveloppes/Enveloppes';
```

Change the placeholder route to:

```tsx
<Route path="/budgets/enveloppes" element={<Enveloppes />} />
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm --prefix frontend run test -- Enveloppes.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx \
  frontend/src/pages/Budgets/Enveloppes/AssignmentInput.tsx \
  frontend/src/pages/Budgets/Enveloppes/__tests__/Enveloppes.test.tsx \
  frontend/src/App.tsx

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): Enveloppes page — month nav + inline assignment editing"
```

---

## Task 12: Reallocate modal

**Files:**
- Create: `frontend/src/pages/Budgets/Enveloppes/ReallocateModal.tsx`
- Create: `frontend/src/pages/Budgets/Enveloppes/__tests__/ReallocateModal.test.tsx`
- Modify: `frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx` (wire the modal)

**Interfaces:**
- Consumes: `useReallocate`, `EnvelopeReportRow[]`.
- Produces: `<ReallocateModal>` component; when confirmed, calls `useReallocate().mutate`.

- [ ] **Step 1: Failing modal test**

Create `frontend/src/pages/Budgets/Enveloppes/__tests__/ReallocateModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReallocateModal } from '../ReallocateModal';

const rows = [
  { categoryId: 1, categoryName: 'A', assignment: '100.00', balance: '100.00' },
  { categoryId: 2, categoryName: 'B', assignment: '50.00', balance: '50.00' },
] as any;

describe('ReallocateModal', () => {
  it('does not confirm when source == dest', () => {
    const spy = vi.fn();
    render(<ReallocateModal
      open source={rows[0]} rows={rows} month="2026-07"
      onClose={vi.fn()} onConfirm={spy}
    />);
    const confirm = screen.getByRole('button', { name: /Confirmer/i });
    // default target is source; button should be disabled
    expect(confirm).toBeDisabled();
  });

  it('confirms with correct payload', () => {
    const spy = vi.fn();
    render(<ReallocateModal
      open source={rows[0]} rows={rows} month="2026-07"
      onClose={vi.fn()} onConfirm={spy}
    />);
    fireEvent.change(screen.getByLabelText(/Vers/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Montant/i), { target: { value: '30,00' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmer/i }));
    expect(spy).toHaveBeenCalledWith({ fromCategoryId: 1, toCategoryId: 2, month: '2026-07', amount: '30.00' });
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --prefix frontend run test -- ReallocateModal.test`

- [ ] **Step 3: Implement `ReallocateModal.tsx`**

Create `frontend/src/pages/Budgets/Enveloppes/ReallocateModal.tsx`:

```tsx
import { useState } from 'react';
import type { EnvelopeReportRow } from '../../../api/types';
import { parseDecimal } from '../../../lib/format';

export function ReallocateModal(props: {
  open: boolean;
  source: EnvelopeReportRow | null;
  rows: EnvelopeReportRow[];
  month: string;
  onClose: () => void;
  onConfirm: (payload: {
    fromCategoryId: number; toCategoryId: number; month: string; amount: string;
  }) => void;
}): JSX.Element | null {
  const [toId, setToId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');

  if (!props.open || !props.source) return null;

  const parsedAmount = parseDecimal(amount);
  const disabled = !toId || toId === props.source.categoryId || parsedAmount == null || parsedAmount <= 0;

  return (
    <div className="fixed inset-0 z-40 bg-ink-950/70 flex items-center justify-center p-4">
      <div className="surface p-6 w-full max-w-md flex flex-col gap-4">
        <h2 className="display text-lg">Réaffecter</h2>
        <div className="text-sm text-ink-400">Depuis <b className="text-ink-100">{props.source.categoryName}</b></div>

        <label className="flex flex-col gap-1 text-sm">
          <span>Vers</span>
          <select
            className="input"
            value={toId ?? ''}
            onChange={(e) => setToId(Number(e.target.value) || null)}
          >
            <option value="">Choisir une enveloppe…</option>
            {props.rows
              .filter((r) => r.categoryId !== props.source!.categoryId)
              .map((r) => <option key={r.categoryId} value={r.categoryId}>{r.categoryName}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>Montant</span>
          <input
            className="input"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={props.onClose}>Annuler</button>
          <button
            className="btn-primary"
            disabled={disabled}
            onClick={() => props.onConfirm({
              fromCategoryId: props.source!.categoryId,
              toCategoryId: toId!,
              month: props.month,
              amount: parsedAmount!.toFixed(2),
            })}
          >Confirmer</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire into `Enveloppes.tsx`**

In `Enveloppes.tsx`, add local state and modal:

```tsx
import { useState } from 'react';
import { useReallocate } from '../../../lib/useEnvelopes';
import { ReallocateModal } from './ReallocateModal';
// ...
const [reallocSource, setReallocSource] = useState<EnvelopeReportRow | null>(null);
const reallocate = useReallocate();
// ...
onReallocateClick={(row) => setReallocSource(row)}
// ...
<ReallocateModal
  open={!!reallocSource}
  source={reallocSource}
  rows={rows}
  month={month}
  onClose={() => setReallocSource(null)}
  onConfirm={(payload) => { reallocate.mutate(payload); setReallocSource(null); }}
/>
```

Add `import type { EnvelopeReportRow } from '../../../api/types';` at the top.

- [ ] **Step 5: Run tests to verify pass**

Run: `npm --prefix frontend run test -- ReallocateModal.test Enveloppes.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Budgets/Enveloppes/ReallocateModal.tsx \
  frontend/src/pages/Budgets/Enveloppes/__tests__/ReallocateModal.test.tsx \
  frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): reallocation modal wired to /api/envelopes/reallocate"
```

---

## Task 13: Hold-for-next-month modal

**Files:**
- Create: `frontend/src/pages/Budgets/Enveloppes/HoldModal.tsx`
- Create: `frontend/src/pages/Budgets/Enveloppes/__tests__/HoldModal.test.tsx`
- Modify: `frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx`

**Interfaces:**
- Consumes: `useUpsertHold`, `pool.available`.
- Produces: modal component; on confirm calls `useUpsertHold().mutate({ month, amount })`.

- [ ] **Step 1: Failing test**

Create `frontend/src/pages/Budgets/Enveloppes/__tests__/HoldModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HoldModal } from '../HoldModal';

describe('HoldModal', () => {
  it('preset "Tout" fills the current pool available', () => {
    render(<HoldModal open month="2026-07" poolAvailable="500.00" onClose={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect(screen.getByLabelText(/Montant/i)).toHaveValue('500,00');
  });

  it('confirms with normalized amount', () => {
    const spy = vi.fn();
    render(<HoldModal open month="2026-07" poolAvailable="500.00" onClose={vi.fn()} onConfirm={spy} />);
    fireEvent.change(screen.getByLabelText(/Montant/i), { target: { value: '250,00' } });
    fireEvent.click(screen.getByRole('button', { name: /Retenir/i }));
    expect(spy).toHaveBeenCalledWith({ month: '2026-07', amount: '250.00' });
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --prefix frontend run test -- HoldModal.test`

- [ ] **Step 3: Implement `HoldModal.tsx`**

Create `frontend/src/pages/Budgets/Enveloppes/HoldModal.tsx`:

```tsx
import { useState } from 'react';
import { parseDecimal } from '../../../lib/format';

export function HoldModal(props: {
  open: boolean;
  month: string;
  poolAvailable: string;
  onClose: () => void;
  onConfirm: (payload: { month: string; amount: string }) => void;
}): JSX.Element | null {
  const [amount, setAmount] = useState('');
  if (!props.open) return null;
  const parsed = parseDecimal(amount);
  const disabled = parsed == null || parsed < 0;
  return (
    <div className="fixed inset-0 z-40 bg-ink-950/70 flex items-center justify-center p-4">
      <div className="surface p-6 w-full max-w-md flex flex-col gap-4">
        <h2 className="display text-lg">Retenir pour le mois prochain</h2>
        <div className="flex items-center gap-2">
          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setAmount('0,00')}>0</button>
          <button className="btn-ghost !py-1 !px-2 text-xs"
                  onClick={() => setAmount(props.poolAvailable.replace('.', ','))}>Tout</button>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span>Montant</span>
          <input
            className="input" type="text" inputMode="decimal"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={props.onClose}>Annuler</button>
          <button
            className="btn-primary"
            disabled={disabled}
            onClick={() => props.onConfirm({ month: props.month, amount: parsed!.toFixed(2) })}
          >Retenir</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire into `Enveloppes.tsx`**

In `Enveloppes.tsx`:

```tsx
import { useUpsertHold } from '../../../lib/useEnvelopes';
import { HoldModal } from './HoldModal';
// ...
const [holdOpen, setHoldOpen] = useState(false);
const upsertHold = useUpsertHold();
// ...
{pool && <PoolCard pool={pool} onHoldClick={() => setHoldOpen(true)} />}
// ...
<HoldModal
  open={holdOpen}
  month={month}
  poolAvailable={pool?.available ?? '0.00'}
  onClose={() => setHoldOpen(false)}
  onConfirm={(payload) => { upsertHold.mutate(payload); setHoldOpen(false); }}
/>
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm --prefix frontend run test -- HoldModal.test Enveloppes.test`

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Budgets/Enveloppes/HoldModal.tsx \
  frontend/src/pages/Budgets/Enveloppes/__tests__/HoldModal.test.tsx \
  frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): hold-for-next-month modal"
```

---

## Task 14: Settings modal (target + overspend policy)

**Files:**
- Create: `frontend/src/pages/Budgets/Enveloppes/SettingsModal.tsx`
- Create: `frontend/src/pages/Budgets/Enveloppes/__tests__/SettingsModal.test.tsx`
- Modify: `frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx`

**Interfaces:**
- Consumes: `useUpsertSettings`, `useDeleteSettings`.
- Produces: modal with target-kind picker (`Aucun` / `save_by_date` / `monthly_recurring` / `save_up_to`), amount, optional date, overspend policy radio; on save calls `upsert`, on "Supprimer l'objectif" calls `delete`.

- [ ] **Step 1: Failing tests**

Create `frontend/src/pages/Budgets/Enveloppes/__tests__/SettingsModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from '../SettingsModal';

const row = {
  categoryId: 1, categoryName: 'Vacances', target: null,
  overspendPolicy: 'rollover_negative' as const,
} as any;

describe('SettingsModal', () => {
  it('saves save_by_date target with amount and date', () => {
    const spy = vi.fn();
    render(<SettingsModal open row={row} onClose={vi.fn()} onSave={spy} onDeleteTarget={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Objectif/i), { target: { value: 'save_by_date' } });
    fireEvent.change(screen.getByLabelText(/Montant/i), { target: { value: '1200,00' } });
    fireEvent.change(screen.getByLabelText(/Échéance/i), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByLabelText(/Réaffectation manuelle/i));
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));
    expect(spy).toHaveBeenCalledWith({
      categoryId: 1,
      body: {
        targetAmount: '1200.00', targetDate: '2026-12-01',
        targetKind: 'save_by_date', overspendPolicy: 'reallocate_manual',
      },
    });
  });

  it('deletes target when the delete button is clicked', () => {
    const rowWithTarget = { ...row, target: { amount: '500.00', date: null, kind: 'monthly_recurring' } };
    const spy = vi.fn();
    render(<SettingsModal open row={rowWithTarget} onClose={vi.fn()} onSave={vi.fn()} onDeleteTarget={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /Supprimer l'objectif/i }));
    expect(spy).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --prefix frontend run test -- SettingsModal.test`

- [ ] **Step 3: Implement**

Create `frontend/src/pages/Budgets/Enveloppes/SettingsModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { EnvelopeReportRow, TargetKind, OverspendPolicy } from '../../../api/types';
import { parseDecimal } from '../../../lib/format';

export function SettingsModal(props: {
  open: boolean;
  row: EnvelopeReportRow | null;
  onClose: () => void;
  onSave: (args: {
    categoryId: number;
    body: {
      targetAmount: string | null;
      targetDate: string | null;
      targetKind: TargetKind | null;
      overspendPolicy: OverspendPolicy;
    };
  }) => void;
  onDeleteTarget: (categoryId: number) => void;
}): JSX.Element | null {
  const row = props.row;
  const [kind, setKind] = useState<TargetKind | ''>('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [policy, setPolicy] = useState<OverspendPolicy>('rollover_negative');

  useEffect(() => {
    if (!row) return;
    setKind(row.target?.kind ?? '');
    setAmount(row.target?.amount ? row.target.amount.replace('.', ',') : '');
    setDate(row.target?.date ?? '');
    setPolicy(row.overspendPolicy);
  }, [row]);

  if (!props.open || !row) return null;

  const parsedAmount = parseDecimal(amount);
  const canSave = kind === '' || parsedAmount != null;

  return (
    <div className="fixed inset-0 z-40 bg-ink-950/70 flex items-center justify-center p-4">
      <div className="surface p-6 w-full max-w-md flex flex-col gap-4">
        <h2 className="display text-lg">Réglages · {row.categoryName}</h2>

        <label className="flex flex-col gap-1 text-sm">
          <span>Objectif</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as TargetKind | '')}>
            <option value="">Aucun</option>
            <option value="save_by_date">Économiser d'ici une date</option>
            <option value="monthly_recurring">Mensuel récurrent</option>
            <option value="save_up_to">Économiser jusqu'à</option>
          </select>
        </label>

        {kind !== '' && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span>Montant</span>
              <input className="input" type="text" inputMode="decimal"
                     value={amount} onChange={(e) => setAmount(e.target.value)}
                     placeholder="0,00" />
            </label>
            {kind === 'save_by_date' && (
              <label className="flex flex-col gap-1 text-sm">
                <span>Échéance</span>
                <input className="input" type="date"
                       value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            )}
          </>
        )}

        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="label">Dépassement</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="policy" value="rollover_negative"
                   checked={policy === 'rollover_negative'}
                   onChange={() => setPolicy('rollover_negative')} />
            Report du solde négatif
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="policy" value="reallocate_manual"
                   checked={policy === 'reallocate_manual'}
                   onChange={() => setPolicy('reallocate_manual')} />
            Réaffectation manuelle (absorbé par le pool)
          </label>
        </fieldset>

        <div className="flex justify-between gap-2">
          {row.target && (
            <button className="btn-ghost text-clay-300"
                    onClick={() => props.onDeleteTarget(row.categoryId)}>
              Supprimer l'objectif
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={props.onClose}>Annuler</button>
            <button
              className="btn-primary"
              disabled={!canSave}
              onClick={() => props.onSave({
                categoryId: row.categoryId,
                body: {
                  targetAmount: kind === '' ? null : parsedAmount!.toFixed(2),
                  targetDate: kind === 'save_by_date' ? (date || null) : null,
                  targetKind: kind === '' ? null : kind,
                  overspendPolicy: policy,
                },
              })}
            >Enregistrer</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire into `Enveloppes.tsx`**

```tsx
import { useUpsertSettings, useDeleteSettings } from '../../../lib/useEnvelopes';
import { SettingsModal } from './SettingsModal';
// ...
const [settingsRow, setSettingsRow] = useState<EnvelopeReportRow | null>(null);
const upsertSettings = useUpsertSettings();
const deleteSettings = useDeleteSettings();
// ...
onSettingsClick={(row) => setSettingsRow(row)}
// ...
<SettingsModal
  open={!!settingsRow}
  row={settingsRow}
  onClose={() => setSettingsRow(null)}
  onSave={(args) => { upsertSettings.mutate(args); setSettingsRow(null); }}
  onDeleteTarget={(categoryId) => { deleteSettings.mutate(categoryId); setSettingsRow(null); }}
/>
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm --prefix frontend run test -- SettingsModal.test Enveloppes.test`

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Budgets/Enveloppes/SettingsModal.tsx \
  frontend/src/pages/Budgets/Enveloppes/__tests__/SettingsModal.test.tsx \
  frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): per-envelope settings modal — targets + overspend policy"
```

---

## Task 15: Empty state, "Non budgétées" section, negative-pool banner polish

**Files:**
- Modify: `frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx`
- Create: `frontend/src/pages/Budgets/Enveloppes/UnbudgetedInline.tsx` (mirrors the caps-mode `UnbudgetedSection` pattern)
- Modify: `frontend/src/pages/Budgets/Enveloppes/__tests__/Enveloppes.test.tsx`

**Interfaces:**
- Consumes: `useEnvelopeReport`, existing category-report endpoint for unbudgeted candidates (reuses same source `UnbudgetedSection` uses — see `frontend/src/pages/Budgets/UnbudgetedSection.tsx:38`).
- Produces: cleaner empty state + inline "Créer une enveloppe" seeding.

- [ ] **Step 1: Failing tests**

Add to `Enveloppes.test.tsx`:

```tsx
it('shows empty-state CTA when the report has no rows', async () => {
  vi.mocked(api).mockImplementation((url: string) => {
    if (url.includes('/report')) return Promise.resolve({
      month: '2026-07',
      pool: { incomeCumulative: '0.00', assignedCumulative: '0.00',
              heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '0.00' },
      rows: [],
    });
    return Promise.resolve({});
  });
  render(wrap(<Enveloppes />));
  expect(await screen.findByText(/Aucune enveloppe/i)).toBeInTheDocument();
});

it('shows negative-pool banner when available < 0', async () => {
  vi.mocked(api).mockImplementation((url: string) => {
    if (url.includes('/report')) return Promise.resolve({
      month: '2026-07',
      pool: { incomeCumulative: '100.00', assignedCumulative: '500.00',
              heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '-400.00' },
      rows: [],
    });
    return Promise.resolve({});
  });
  render(wrap(<Enveloppes />));
  expect(await screen.findByText(/sur-budgété/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to see failures**

Run: `npm --prefix frontend run test -- Enveloppes.test`
Expected: FAIL on the two new cases.

- [ ] **Step 3: Adjust empty-state copy and confirm banner is present**

In `Enveloppes.tsx`, update the empty-state block:

```tsx
{rows.length === 0 && reportQ.isSuccess && (
  <div className="surface p-6 text-center flex flex-col gap-3">
    <div className="display text-lg">Aucune enveloppe pour ce mois</div>
    <div className="text-sm text-ink-400">
      Créez votre première enveloppe pour commencer.
    </div>
  </div>
)}
```

The negative-pool banner is already in `Enveloppes.tsx` from Task 11; verify the test matches the exact text.

- [ ] **Step 4: Add the "Non budgétées" collapsible section**

Categories with spend but no envelope for the current month are candidates
for creating an envelope. Derive the list client-side from the existing
`rows`:

In `Enveloppes.tsx`, add the following just before the closing `</div>` of
the main flex container (after the envelope list, before the modals):

```tsx
{rows.some((r) => Number(r.spend) > 0 && Number(r.assignment) === 0 && Number(r.balancePriorMonth) === 0) && (
  <UnbudgetedInline
    rows={rows.filter((r) =>
      Number(r.spend) > 0 &&
      Number(r.assignment) === 0 &&
      Number(r.balancePriorMonth) === 0
    )}
    onCreate={(categoryId, suggestedAmount) =>
      upsertAsg.mutate({ categoryId, month, amount: suggestedAmount })
    }
  />
)}
```

Then create `frontend/src/pages/Budgets/Enveloppes/UnbudgetedInline.tsx`:

```tsx
import { useState } from 'react';
import type { EnvelopeReportRow } from '../../../api/types';
import { formatAmount } from '../../../lib/format';

export function UnbudgetedInline(props: {
  rows: EnvelopeReportRow[];
  onCreate: (categoryId: number, suggestedAmount: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="surface p-4 flex flex-col gap-3">
      <button
        type="button"
        className="flex items-center justify-between text-sm text-ink-300"
        onClick={() => setOpen(!open)}
      >
        <span>Non budgétées ce mois ({props.rows.length})</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-2 text-sm">
          {props.rows.map((r) => (
            <li key={r.categoryId} className="flex items-center justify-between">
              <span>
                {r.categoryName}{' '}
                <span className="text-ink-500 text-xs">
                  (dépensé {formatAmount(r.spend)})
                </span>
              </span>
              <button
                type="button"
                className="btn-ghost !py-1 !px-2 text-xs"
                onClick={() => props.onCreate(r.categoryId, r.spend)}
              >
                Créer une enveloppe
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Add the import at the top of `Enveloppes.tsx`:

```tsx
import { UnbudgetedInline } from './UnbudgetedInline';
```

- [ ] **Step 5: Add a failing test for the Non-budgétées section**

Append to `Enveloppes.test.tsx`:

```tsx
it('surfaces Non budgétées section when a category has spend but no envelope', async () => {
  vi.mocked(api).mockImplementation((url: string) => {
    if (url.includes('/report')) return Promise.resolve({
      month: '2026-07',
      pool: { incomeCumulative: '1000.00', assignedCumulative: '0.00',
              heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '1000.00' },
      rows: [{ categoryId: 42, categoryName: 'Restaurants',
               balancePriorMonth: '0.00', assignment: '0.00', spend: '80.00',
               balance: '-80.00', target: null,
               overspendPolicy: 'rollover_negative', overspent: true,
               absorbedByPool: '0.00', monthsToTarget: null }],
    });
    return Promise.resolve({});
  });
  render(wrap(<Enveloppes />));
  expect(await screen.findByText(/Non budgétées ce mois \(1\)/)).toBeInTheDocument();
});
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm --prefix frontend run test -- Enveloppes.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Budgets/Enveloppes/Enveloppes.tsx \
  frontend/src/pages/Budgets/Enveloppes/UnbudgetedInline.tsx \
  frontend/src/pages/Budgets/Enveloppes/__tests__/Enveloppes.test.tsx

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(envelopes): empty state, Non-budgétées section, negative-pool banner"
```

---

## Task 16: Dashboard tile (`BudgetEnvelopeSection`)

**Files:**
- Create: `frontend/src/pages/Dashboard/BudgetEnvelopeSection.tsx`
- Create: `frontend/src/pages/Dashboard/__tests__/BudgetEnvelopeSection.test.tsx`
- Modify: `frontend/src/pages/Dashboard/index.tsx` — one import, one JSX line between `<InsightsSection />` and `<MoyennesMensuellesSection />`.

**Interfaces:**
- Consumes: `useEnvelopeReport(currentMonth)`.
- Produces: `<BudgetEnvelopeSection />` returning `null` for caps-only users.

- [ ] **Step 1: Failing tests**

Create `frontend/src/pages/Dashboard/__tests__/BudgetEnvelopeSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BudgetEnvelopeSection } from '../BudgetEnvelopeSection';

vi.mock('../../../api/client', () => ({ api: vi.fn() }));
import { api } from '../../../api/client';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('BudgetEnvelopeSection', () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it('renders nothing for a caps-only user (empty report, no pool activity)', async () => {
    vi.mocked(api).mockResolvedValue({
      month: '2026-07',
      pool: { incomeCumulative: '0.00', assignedCumulative: '0.00',
              heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '0.00' },
      rows: [],
    });
    const { container } = render(wrap(<BudgetEnvelopeSection />));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.firstChild).toBeNull();
  });

  it('renders four columns when data exists', async () => {
    vi.mocked(api).mockResolvedValue({
      month: '2026-07',
      pool: { incomeCumulative: '1000.00', assignedCumulative: '500.00',
              heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '500.00' },
      rows: [{ categoryId: 1, categoryName: 'A', balancePriorMonth: '0.00', assignment: '500.00',
               spend: '400.00', balance: '100.00', target: null,
               overspendPolicy: 'rollover_negative', overspent: false,
               absorbedByPool: '0.00', monthsToTarget: null }],
    });
    render(wrap(<BudgetEnvelopeSection />));
    expect(await screen.findByText(/Disponible/i)).toBeInTheDocument();
    expect(screen.getByText(/Assigné/i)).toBeInTheDocument();
    expect(screen.getByText(/Sur-budget/i)).toBeInTheDocument();
    expect(screen.getByText(/Retenu/i)).toBeInTheDocument();
  });

  it('shows red styling on the available number when pool is negative', async () => {
    vi.mocked(api).mockResolvedValue({
      month: '2026-07',
      pool: { incomeCumulative: '100.00', assignedCumulative: '500.00',
              heldFromPriorMonths: '0.00', heldForNextMonth: '0.00', available: '-400.00' },
      rows: [{ categoryId: 1, categoryName: 'A', balancePriorMonth: '0.00', assignment: '500.00',
               spend: '0.00', balance: '500.00', target: null,
               overspendPolicy: 'rollover_negative', overspent: false,
               absorbedByPool: '0.00', monthsToTarget: null }],
    });
    render(wrap(<BudgetEnvelopeSection />));
    const el = await screen.findByText('−400,00 €');
    expect(el.className).toMatch(/text-clay-300/);
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npm --prefix frontend run test -- BudgetEnvelopeSection.test`

- [ ] **Step 3: Implement `BudgetEnvelopeSection.tsx`**

Create `frontend/src/pages/Dashboard/BudgetEnvelopeSection.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { useEnvelopeReport } from '../../lib/useEnvelopes';
import { formatAmount } from '../../lib/format';
import { formatSignedMoney } from '../Budgets/envelope-math';

function currentMonthYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function BudgetEnvelopeSection(): JSX.Element | null {
  const month = currentMonthYm();
  const q = useEnvelopeReport(month);
  const data = q.data;

  if (!data) return null;
  const hasAnything =
    data.rows.length > 0 ||
    Number(data.pool.available) !== 0 ||
    Number(data.pool.incomeCumulative) > 0;
  if (!hasAnything) return null;

  const overspentCount = data.rows.filter((r) => r.overspent).length;
  const negative = Number(data.pool.available) < 0;
  const income = Number(data.pool.incomeCumulative);
  const assigned = Number(data.pool.assignedCumulative);
  const pct = income > 0 ? Math.min(1, assigned / income) : 0;

  return (
    <section className="surface p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="label">Enveloppes</div>
          <div className="text-sm text-ink-400 capitalize">{new Date(month + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</div>
        </div>
        <Link className="text-sage-300 text-sm hover:underline" to={`/budgets/enveloppes?month=${month}`}>
          Voir tout →
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="label">Disponible</div>
          <div className={`display text-2xl ${negative ? 'text-clay-300' : 'text-ink-50'}`}>
            {formatSignedMoney(data.pool.available)}
          </div>
        </div>
        <div>
          <div className="label">Assigné</div>
          <div className="text-xl">{formatAmount(data.pool.assignedCumulative)}</div>
          <div className="h-1.5 mt-1 bg-ink-800 rounded">
            <div className="h-full bg-sage-500 rounded" style={{ width: `${(pct * 100).toFixed(0)}%` }} />
          </div>
        </div>
        <div>
          <div className="label">Sur-budget</div>
          <Link to={`/budgets/enveloppes?month=${month}`}
                className={`text-xl inline-flex items-center gap-1 ${overspentCount > 0 ? 'text-clay-300' : 'text-ink-400'}`}>
            {overspentCount} catégorie{overspentCount === 1 ? '' : 's'}
            {overspentCount > 0 && <span aria-hidden>⚠</span>}
          </Link>
        </div>
        <div>
          <div className="label">Retenu</div>
          <div className={`text-xl ${Number(data.pool.heldForNextMonth) === 0 ? 'text-ink-500' : 'text-ink-100'}`}>
            {formatAmount(data.pool.heldForNextMonth)}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Mount in `Dashboard/index.tsx`**

Add the import at the top of `frontend/src/pages/Dashboard/index.tsx`:

```ts
import { BudgetEnvelopeSection } from './BudgetEnvelopeSection';
```

Add `<BudgetEnvelopeSection />` between `<InsightsSection />` and `<MoyennesMensuellesSection />` in the JSX.

- [ ] **Step 5: Run tests to verify pass**

Run: `npm --prefix frontend run test -- BudgetEnvelopeSection.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Dashboard/BudgetEnvelopeSection.tsx \
  frontend/src/pages/Dashboard/__tests__/BudgetEnvelopeSection.test.tsx \
  frontend/src/pages/Dashboard/index.tsx

git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(dashboard): envelope-mode tile, self-hides for caps-only users"
```

---

## Final verification

- [ ] **Step 1: Full backend test suite**

Run: `RUN_DB_TESTS=1 npx --prefix backend vitest run`
Expected: all tests pass; envelope-math, envelope-schema, envelopes-route, plus existing budgets suite untouched.

- [ ] **Step 2: Full frontend test suite**

Run: `npm --prefix frontend run test`
Expected: all tests pass; Plafonds, Layout, redirects, Enveloppes, all four modals, PoolCard, EnvelopeRow, envelope-math, BudgetEnvelopeSection all green.

- [ ] **Step 3: Manual smoke walk-through**

With Postgres running:

1. Log in as an existing caps user. Confirm `/budgets` redirects to `/budgets/plafonds`; the Plafonds page behaves identically to the pre-change Budgets page. Dashboard shows no envelope tile.
2. Click `/budgets/enveloppes` in the nav. Confirm empty-state copy.
3. Add an income transaction (€1000, June). Refresh `/budgets/enveloppes?month=2026-06`. Confirm pool = €1000 available.
4. Add an assignment (€300 to Alimentation, June). Confirm pool drops to €700 and the row shows €300 assignment.
5. Add a spend transaction (-€100, June, Alimentation). Confirm row spend = €100, balance = €200.
6. Advance to July and back — confirm July's `balancePriorMonth` = €200.
7. Reallocate €50 from Alimentation to a new envelope; both rows update.
8. Set Alimentation policy to `reallocate_manual`, add a spend that overspends. Refresh next month — envelope shows €0 with the absorbé chip and pool shows the deduction.
9. Hit "Retenir…" and hold €200 for next month. Refresh — next month's pool shows €200 released.
10. Set a `save_by_date` target on a category; confirm the progress bar renders correctly on both the Enveloppes page and (indirectly) the Dashboard tile counts.
11. Dashboard tile now visible with pool + assigned progress + overspent count + held.

- [ ] **Step 4: Public-safe scan before pushing**

Run: `git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com log --stat main | rg -i "192\.168|10\.0\.|localhost|password|secret" | head`
Expected: no matches.

- [ ] **Step 5: No push**

Per project policy — leave commits local until the user explicitly asks to push. Report the commit range instead:

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com log --oneline main --since='today' | head -20
```

## Self-Review Notes

- **Spec coverage:** each of the six spec sections has explicit tasks — nav (Task 8), data model (Task 1), semantics (Task 2 + 7), API surface (Tasks 3–7), Enveloppes UX (Tasks 11–15), Dashboard tile (Task 16). Rollout is covered by Final Verification.
- **Placeholders:** none — every step has real code or exact commands.
- **Type consistency:** `EnvelopeReport`, `EnvelopeReportRow`, `TargetKind`, `OverspendPolicy`, `EnvelopeAssignment`, `EnvelopeCategorySettings`, `EnvelopeHold` used consistently in types (Task 9), consumed by hooks and components (Tasks 10+), matching the report response shape produced in Task 7.
- **Migration numbering:** verified 0024-0026 are free (0023 = `dismissed_tips`).
- **Test placement:** matches existing conventions (`backend/tests/*.test.ts`, `frontend/src/**/__tests__/*.test.{tsx,ts}`).
