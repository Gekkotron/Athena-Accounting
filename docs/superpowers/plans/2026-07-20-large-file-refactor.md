# Large-file refactor (pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split 3 source files >400 lines into cohesive per-concern modules and add unit tests for the pure logic extracted along the way.

**Architecture:** Follow the existing repo convention: single-file routes become a folder `routes/<resource>/{index,schemas,helpers,...}.ts` — matches how `backup/` and `transactions/` are already organized. React pages become a folder-like sibling group in `pages/Rules/`. Pure helpers move to dedicated files with focused unit tests; existing integration tests (route tests, page tests) remain untouched and continue to protect the route composition and rendering.

**Tech Stack:** TypeScript (NodeNext modules on backend, Vite/tsc on frontend), Fastify, Drizzle ORM, Zod, React 18, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-20-large-file-refactor-design.md`

## Global Constraints

- **Test framework:** Vitest, already configured on both `backend/` and `frontend/` workspaces. No new dependencies.
- **Module resolution:** Backend uses `"type": "module"` with NodeNext resolution — every relative import MUST include the `.js` extension. Frontend imports use no extension.
- **Commit identity:** Attribute every commit to `Gekkotron` (`60887050+Gekkotron@users.noreply.github.com`) via `-c user.name=… -c user.email=…` — do NOT modify `.git/config`. Direct to `main` (project convention — no feature branches).
- **Verification gate per task:** Suite fully green (not just the new file) AND workspace build passes BEFORE commit.
  - Backend: `npm --prefix backend test` then `npm --prefix backend run build`.
  - Frontend: `npm --prefix frontend test` then `npm --prefix frontend run build`.
- **Public-safe commits:** No IPs, hostnames, or secrets in any file touched by this plan.
- **Trailer:** Every commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 0: Baseline — confirm suites are green before we start

**Files:** none (checkpoint only).

**Interfaces:**
- Consumes: nothing.
- Produces: confidence that regressions in later tasks are ours, not pre-existing.

- [ ] **Step 1: Run backend suite**

Run: `npm --prefix backend test`
Expected: all tests pass, no unhandled errors.

If any test fails, STOP and report — the pilot assumes a green baseline.

- [ ] **Step 2: Run frontend suite**

Run: `npm --prefix frontend test`
Expected: all tests pass.

- [ ] **Step 3: Confirm both workspaces build**

Run: `npm --prefix backend run build && npm --prefix frontend run build`
Expected: both succeed with no TypeScript errors.

No commit — this is a preflight check only.

---

## Task 1: Split `backend/src/http/routes/reports.ts` (627 lines)

**Files:**
- Create: `backend/src/http/routes/reports/schemas.ts`
- Create: `backend/src/http/routes/reports/sql-fragments.ts`
- Create: `backend/src/http/routes/reports/period-math.ts`
- Create: `backend/src/http/routes/reports/balance.ts`
- Create: `backend/src/http/routes/reports/timeseries.ts`
- Create: `backend/src/http/routes/reports/categories.ts`
- Create: `backend/src/http/routes/reports/budget.ts`
- Create: `backend/src/http/routes/reports/index.ts`
- Delete: `backend/src/http/routes/reports.ts`
- Modify: `backend/src/buildServer.ts` (one import line)
- Test: `backend/tests/reports-period-math.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used only inside `routes/reports/`):
  - `period-math.ts`
    - `elapsedIn(start: Date, endExclusive: Date, now: Date): number`
    - `computeProjected(spent: number, elapsedDays: number, windowDays: number, endExclusive: Date, now: Date): string | null`
    - `priorPeriodKeys(period: 'monthly' | 'yearly', currentStart: Date): string[]`
    - `mean(values: number[]): number`
    - `median(values: number[]): number`
    - `stdev(values: number[]): number`
    - `annotateBudgetRow(input: { spent: number; limit: number; elapsedDays: number; windowDays: number; periodEndExclusive: Date; now: Date; historyValuesNum: number[] }): { projected: string | null; history: { values: string[]; average: string; median: string } | null; anomaly: boolean; suggestedLimit: string | null }`
  - `schemas.ts`: `RangeQuery`, `BudgetQuery` (Zod schemas)
  - `sql-fragments.ts`: `TX_EFFECTIVE_CTE` (Drizzle `sql` fragment)
  - `index.ts`: `export async function reportsRoutes(app: FastifyInstance): Promise<void>` — same signature as today (drop-in for `buildServer.ts`).

- [ ] **Step 1: Write the failing unit test for `period-math`**

Create `backend/tests/reports-period-math.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  annotateBudgetRow,
  computeProjected,
  elapsedIn,
  mean,
  median,
  priorPeriodKeys,
  stdev,
} from '../src/http/routes/reports/period-math.js';

const UTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('elapsedIn', () => {
  it('strictly-past period clamps to the whole window', () => {
    const start = UTC(2026, 1, 1);
    const end = UTC(2026, 2, 1);
    const now = UTC(2026, 5, 15);
    expect(elapsedIn(start, end, now)).toBe(31);
  });

  it('strictly-future period returns 0', () => {
    const start = UTC(2027, 1, 1);
    const end = UTC(2027, 2, 1);
    const now = UTC(2026, 5, 15);
    expect(elapsedIn(start, end, now)).toBe(0);
  });

  it('current period, day 1 = 1', () => {
    const start = UTC(2026, 7, 1);
    const end = UTC(2026, 8, 1);
    const now = UTC(2026, 7, 1);
    expect(elapsedIn(start, end, now)).toBe(1);
  });

  it('current period, mid month counts inclusive of today', () => {
    const start = UTC(2026, 7, 1);
    const end = UTC(2026, 8, 1);
    const now = UTC(2026, 7, 10);
    expect(elapsedIn(start, end, now)).toBe(10);
  });

  it('boundary: today == endExclusive → whole window (past)', () => {
    const start = UTC(2026, 7, 1);
    const end = UTC(2026, 8, 1);
    expect(elapsedIn(start, end, end)).toBe(31);
  });
});

describe('computeProjected', () => {
  const start = UTC(2026, 7, 1);
  const end = UTC(2026, 8, 1);

  it('past period locks to spent', () => {
    const now = UTC(2026, 9, 1);
    expect(computeProjected(500, 31, 31, end, now)).toBe('500.00');
  });

  it('elapsedDays < 3 returns null', () => {
    const now = UTC(2026, 7, 2);
    expect(computeProjected(50, 2, 31, end, now)).toBeNull();
  });

  it('linear extrapolation across the window', () => {
    const now = UTC(2026, 7, 10);
    // spent 100 in 10 days, window 31 days → 310.00
    expect(computeProjected(100, 10, 31, end, now)).toBe('310.00');
  });
});

describe('priorPeriodKeys', () => {
  it('monthly returns 6 prior YYYY-MM keys, oldest first, no Jan-wrap bug', () => {
    // currentStart Feb 2026 → prior 6 months Aug 2025 … Jan 2026
    const keys = priorPeriodKeys('monthly', UTC(2026, 2, 1));
    expect(keys).toEqual(['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
  });

  it('yearly returns 6 prior YYYY keys, oldest first', () => {
    const keys = priorPeriodKeys('yearly', UTC(2026, 1, 1));
    expect(keys).toEqual(['2020', '2021', '2022', '2023', '2024', '2025']);
  });
});

describe('mean / median / stdev', () => {
  it('mean of empty returns 0', () => {
    expect(mean([])).toBe(0);
  });

  it('mean of single element', () => {
    expect(mean([5])).toBe(5);
  });

  it('mean averages', () => {
    expect(mean([2, 4, 6])).toBeCloseTo(4);
  });

  it('median: empty → 0', () => {
    expect(median([])).toBe(0);
  });

  it('median: odd length picks middle', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('median: even length averages two middles', () => {
    expect(median([1, 2, 3, 4])).toBeCloseTo(2.5);
  });

  it('stdev of <2 elements returns 0', () => {
    expect(stdev([])).toBe(0);
    expect(stdev([7])).toBe(0);
  });

  it('stdev of all-equal is 0', () => {
    expect(stdev([5, 5, 5, 5])).toBe(0);
  });

  it('stdev of a known set', () => {
    // population stdev of [2,4,4,4,5,5,7,9] = 2
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2);
  });
});

describe('annotateBudgetRow', () => {
  const now = UTC(2026, 7, 10);
  const periodEndExclusive = UTC(2026, 8, 1);

  it('all-zero history → history=null, anomaly=false, suggestedLimit=null', () => {
    const out = annotateBudgetRow({
      spent: 40, limit: 100, elapsedDays: 10, windowDays: 31,
      periodEndExclusive, now, historyValuesNum: [0, 0, 0, 0, 0, 0],
    });
    expect(out.history).toBeNull();
    expect(out.anomaly).toBe(false);
    expect(out.suggestedLimit).toBeNull();
    expect(out.projected).toBe('124.00');
  });

  it('qualifying history (≥2 non-zero) exposes history block', () => {
    const out = annotateBudgetRow({
      spent: 40, limit: 100, elapsedDays: 10, windowDays: 31,
      periodEndExclusive, now, historyValuesNum: [30, 40, 0, 0, 0, 0],
    });
    expect(out.history).not.toBeNull();
    expect(out.history!.values).toHaveLength(6);
  });

  it('anomaly requires ≥3 non-zero AND |spent-mean| > stdev', () => {
    // history [30,40,50,0,0,0]: nonZero=3, mean=20, stdev>0, spent 200 is anomalous
    const out = annotateBudgetRow({
      spent: 200, limit: 100, elapsedDays: 10, windowDays: 31,
      periodEndExclusive, now, historyValuesNum: [30, 40, 50, 0, 0, 0],
    });
    expect(out.anomaly).toBe(true);
  });

  it('suggestedLimit fires when overCount ≥ 3 and rounds up ~10%', () => {
    // history all > 100 → overCount=4, median=110, round(110)*1.1=121
    const out = annotateBudgetRow({
      spent: 90, limit: 100, elapsedDays: 10, windowDays: 31,
      periodEndExclusive, now, historyValuesNum: [110, 110, 110, 110, 0, 0],
    });
    expect(out.suggestedLimit).toBe('121.00');
  });

  it('suggestedLimit stays null when history is too sparse', () => {
    const out = annotateBudgetRow({
      spent: 90, limit: 100, elapsedDays: 10, windowDays: 31,
      periodEndExclusive, now, historyValuesNum: [110, 0, 0, 0, 0, 0],
    });
    expect(out.suggestedLimit).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm --prefix backend test -- reports-period-math`
Expected: FAIL with "Cannot find module '.../reports/period-math.js'" (or similar).

- [ ] **Step 3: Create `period-math.ts` with the extracted pure logic**

Create `backend/src/http/routes/reports/period-math.ts`:

```ts
// Days elapsed inside [start, endExclusive), clamped to the window. Uses UTC
// midnight of `now` so the boundary is consistent with the SQL date filter.
// - Strictly past periods (today's midnight >= endExclusive) clamp to the
//   whole window (elapsedDays === windowDays).
// - Strictly future periods (today's midnight < start) are 0.
// - Otherwise (today falls inside [start, endExclusive)) day 1 of the period
//   counts as elapsedDays = 1, day 2 as 2, etc. (inclusive of today).
export function elapsedIn(start: Date, endExclusive: Date, now: Date): number {
  const todayUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (todayUtcMidnight >= endExclusive) {
    return Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000);
  }
  if (todayUtcMidnight < start) return 0;
  return Math.round((todayUtcMidnight.getTime() - start.getTime()) / 86_400_000) + 1;
}

// projected = null when it's too early in the current period to extrapolate
// (elapsedDays < 3); locked to `spent` for strictly past periods; otherwise a
// linear extrapolation of spend across the whole window.
export function computeProjected(
  spent: number,
  elapsedDays: number,
  windowDays: number,
  endExclusive: Date,
  now: Date,
): string | null {
  if (now >= endExclusive) return spent.toFixed(2);
  if (elapsedDays < 3) return null;
  return (spent / elapsedDays * windowDays).toFixed(2);
}

// Six most recent *completed* periods before `currentStart`, oldest first.
export function priorPeriodKeys(period: 'monthly' | 'yearly', currentStart: Date): string[] {
  const keys: string[] = [];
  if (period === 'monthly') {
    for (let i = 6; i >= 1; i--) {
      const d = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - i, 1));
      keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
  } else {
    for (let i = 6; i >= 1; i--) {
      keys.push(String(currentStart.getUTCFullYear() - i));
    }
  }
  return keys;
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / (values.length || 1);
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

// Per-row annotation for the /budget response. Pulled out so the branchy
// history / anomaly / suggestedLimit gating is unit-testable in isolation.
export function annotateBudgetRow(input: {
  spent: number;
  limit: number;
  elapsedDays: number;
  windowDays: number;
  periodEndExclusive: Date;
  now: Date;
  historyValuesNum: number[];
}): {
  projected: string | null;
  history: { values: string[]; average: string; median: string } | null;
  anomaly: boolean;
  suggestedLimit: string | null;
} {
  const { spent, limit, elapsedDays, windowDays, periodEndExclusive, now, historyValuesNum } = input;

  const projected = computeProjected(spent, elapsedDays, windowDays, periodEndExclusive, now);
  const nonZeroCount = historyValuesNum.filter((v) => v > 0).length;

  const history = nonZeroCount >= 2
    ? {
        values: historyValuesNum.map((v) => v.toFixed(2)),
        average: mean(historyValuesNum).toFixed(2),
        median: median(historyValuesNum).toFixed(2),
      }
    : null;

  // Gate on nonZeroCount (not historyValuesNum.length, which is always 6 due
  // to zero-padding): stdev computed against a mostly-zero-padded array is
  // not a meaningful anomaly signal.
  const anomaly = history !== null
    && nonZeroCount >= 3
    && Math.abs(spent - mean(historyValuesNum)) > stdev(historyValuesNum);

  const overCount = historyValuesNum.filter((v) => v > limit).length;
  const underHalfCount = limit > 0
    ? historyValuesNum.filter((v) => v < limit * 0.5).length
    : 0;
  const medianValue = median(historyValuesNum);
  const proposedValue = Math.round(Math.round(medianValue) * 1.1);
  const suggestedLimit = history !== null
    && proposedValue > 0
    && (overCount >= 3 || underHalfCount >= 3)
    ? proposedValue.toFixed(2)
    : null;

  return { projected, history, anomaly, suggestedLimit };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm --prefix backend test -- reports-period-math`
Expected: PASS (all `elapsedIn`, `computeProjected`, `priorPeriodKeys`, `mean`, `median`, `stdev`, `annotateBudgetRow` blocks green).

- [ ] **Step 5: Create `schemas.ts`**

Create `backend/src/http/routes/reports/schemas.ts`:

```ts
import { z } from 'zod';

export const RangeQuery = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(['day', 'month']).default('day'),
  // Optional per-account filter. Applied to the categories report so the
  // Dashboard donut can follow the currently-scoped account. Not applied to
  // the other endpoints in this file — they aggregate across accounts by
  // design.
  accountId: z.coerce.number().int().positive().optional(),
});

export const BudgetQuery = z.object({
  period: z.enum(['monthly', 'yearly']).default('monthly'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM').optional(),
  year: z.string().regex(/^\d{4}$/, 'must be YYYY').optional(),
  accountId: z.coerce.number().int().positive().optional(),
});
```

- [ ] **Step 6: Create `sql-fragments.ts`**

Create `backend/src/http/routes/reports/sql-fragments.ts`:

```ts
import { sql } from 'drizzle-orm';

// Shared "effective transactions" CTE body: a transaction with no splits
// contributes itself; a split transaction contributes one row per split.
// Used by both the categories report and the budget report so they count
// splits identically. Includes account_id — the categories report filters
// on it; the budget report ignores that column.
export const TX_EFFECTIVE_CTE = sql`
      tx_effective AS (
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
      )`;
```

- [ ] **Step 7: Create `balance.ts`**

Create `backend/src/http/routes/reports/balance.ts`. Copy the entire `app.get('/api/reports/balance', ...)` call from the current `reports.ts` (lines 119-178, inclusive of `app.get(` through the matching `);`) verbatim, wrapping it in a `registerBalanceRoute(app)` export. Keep every comment. No import paraphrasing — every import listed below must be present:

```ts
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';

export function registerBalanceRoute(app: FastifyInstance): void {
  // Paste `app.get('/api/reports/balance', async (req) => { … });`
  // verbatim from reports.ts lines 119-178 here.
}
```

- [ ] **Step 8: Create `timeseries.ts`**

Same pattern as Step 7. Copy `app.get('/api/reports/timeseries', …);` from lines 184-242 of current `reports.ts` verbatim into a `registerTimeseriesRoute(app)` export:

```ts
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';
import { RangeQuery } from './schemas.js';

export function registerTimeseriesRoute(app: FastifyInstance): void {
  // Paste `app.get('/api/reports/timeseries', async (req, reply) => { … });`
  // verbatim from reports.ts lines 184-242 here.
}
```

- [ ] **Step 9: Create `categories.ts`**

Same pattern. Copy `app.get('/api/reports/categories', …);` from lines 248-289 of current `reports.ts` verbatim. The `TX_EFFECTIVE_CTE` reference is now imported from `./sql-fragments.js`:

```ts
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';
import { RangeQuery } from './schemas.js';
import { TX_EFFECTIVE_CTE } from './sql-fragments.js';

export function registerCategoriesReportRoute(app: FastifyInstance): void {
  // Paste `app.get('/api/reports/categories', async (req, reply) => { … });`
  // verbatim from reports.ts lines 248-289 here.
}
```

- [ ] **Step 10: Create `budget.ts`**

Move the `/api/reports/budget` handler (lines 302-626 of current `reports.ts`) into this file, and refactor its per-row annotation to call `annotateBudgetRow` from `period-math.ts` instead of doing it inline.

```ts
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';
import { BudgetQuery } from './schemas.js';
import { TX_EFFECTIVE_CTE } from './sql-fragments.js';
import { annotateBudgetRow, elapsedIn, priorPeriodKeys } from './period-math.js';

export function registerBudgetRoute(app: FastifyInstance): void {
  app.get('/api/reports/budget', async (req, reply) => {
    // ... verbatim body EXCEPT the row .map(...) block.
  });
}
```

**The one non-mechanical change is the `rows` `.map(r => …)` block.** In the current file, this block (lines 463-540) computes `projected`, `history`, `anomaly`, `suggestedLimit`, and the totals fold. Replace the ~78 lines that compute `projected`, `history`, `anomaly`, `suggestedLimit` with a single call:

```ts
const rows = rowsFiltered.map((r) => {
  const limit = Number(r.limit);
  const spent = Number(r.spent);

  const priorKeys = priorPeriodKeys(period, periodStart);
  const catHist = historyByBudget.get(r.id) ?? new Map<string, string>();
  const historyValuesNum = priorKeys.map((k) => Number(catHist.get(k) ?? '0'));

  const annotated = annotateBudgetRow({
    spent, limit, elapsedDays, windowDays, periodEndExclusive, now, historyValuesNum,
  });

  const includeInTotals = r.parent_id == null || !budgetedCategoryIds.has(r.parent_id);
  if (includeInTotals) {
    totalLimit += limit;
    totalSpent += spent;
    if (totalProjected !== null) {
      if (annotated.projected == null) totalProjected = null;
      else totalProjected += Number(annotated.projected);
    }
  }

  return {
    id: r.id,
    categoryId: r.category_id,
    name: r.name,
    color: r.color,
    parentId: r.parent_id,
    accountId: r.account_id,
    period: r.period as 'monthly' | 'yearly',
    limit: r.limit,
    currency: r.currency,
    spent: spent.toFixed(2),
    remaining: (limit - spent).toFixed(2),
    pct: limit > 0 ? Math.round((spent / limit) * 100) : 0,
    over: spent > limit,
    projected: annotated.projected,
    history: annotated.history,
    anomaly: annotated.anomaly,
    suggestedLimit: annotated.suggestedLimit,
  };
});
```

The rest of the handler (period-bounds resolution, first `db.execute`, history query, unbudgetedCandidates query, response assembly) is copied verbatim.

- [ ] **Step 11: Create `index.ts`**

Create `backend/src/http/routes/reports/index.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { registerBalanceRoute } from './balance.js';
import { registerTimeseriesRoute } from './timeseries.js';
import { registerCategoriesReportRoute } from './categories.js';
import { registerBudgetRoute } from './budget.js';

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);
  registerBalanceRoute(app);
  registerTimeseriesRoute(app);
  registerCategoriesReportRoute(app);
  registerBudgetRoute(app);
}
```

- [ ] **Step 12: Delete the old `reports.ts`**

Run: `rm backend/src/http/routes/reports.ts`

- [ ] **Step 13: Update the import in `buildServer.ts`**

Edit `backend/src/buildServer.ts`. Change:

```ts
import { reportsRoutes } from './http/routes/reports.js';
```

to:

```ts
import { reportsRoutes } from './http/routes/reports/index.js';
```

(Matches how `transactionsRoutes` and `backupRoutes` are already imported.)

- [ ] **Step 14: Run backend suite, verify all green**

Run: `npm --prefix backend test`
Expected: all tests pass, including `reports-route.test.ts` (403 lines) and the new `reports-period-math.test.ts`.

If any existing test in `reports-route.test.ts` fails, the `annotateBudgetRow` extraction drifted from the original — diff the old inline logic against the new helper and fix before proceeding.

- [ ] **Step 15: Run backend build**

Run: `npm --prefix backend run build`
Expected: `tsc -p tsconfig.json && node scripts/copy-migrations.mjs` succeeds with no errors.

- [ ] **Step 16: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    add backend/src/http/routes/reports \
        backend/src/buildServer.ts \
        backend/tests/reports-period-math.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    add -u backend/src/http/routes/reports.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
refactor(reports): split reports.ts into per-handler modules and unit-test period math

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verify with `git status` (working tree clean) and `git log -1 --stat`.

---

## Task 2: Split `frontend/src/pages/Rules/Categories.tsx` (572 lines)

**Files:**
- Create: `frontend/src/pages/Rules/categoriesTotals.ts`
- Create: `frontend/src/pages/Rules/CategoryTableRow.tsx`
- Create: `frontend/src/pages/Rules/DragGhost.tsx`
- Modify: `frontend/src/pages/Rules/Categories.tsx` (shrink to ~250 lines)
- Test: `frontend/src/pages/Rules/__tests__/categoriesTotals.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used only inside `pages/Rules/`):
  - `categoriesTotals.ts`:
    - `buildOwnTotalsByCat(report: CategoryReportRow[]): Map<number, number>`
    - `rolledUpTotal(cat: Category, ownTotals: Map<number, number>, childrenByParent: Map<number, Category[]>): number`
  - `CategoryTableRow.tsx`: default-exported component `CategoryTableRow(props)` — same props as the current inline `CategoryTableRow`.
  - `DragGhost.tsx`: default-exported component `DragGhost({ id, byId })` — same props as today.

- [ ] **Step 1: Write the failing unit test for `categoriesTotals`**

Create `frontend/src/pages/Rules/__tests__/categoriesTotals.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Category, CategoryReportRow } from '../../../api/types';
import { buildOwnTotalsByCat, rolledUpTotal } from '../categoriesTotals';

const cat = (id: number, parentId: number | null = null): Category => ({
  id,
  name: `cat-${id}`,
  kind: 'expense',
  parentId,
  color: null,
  isDefault: false,
  isInternalTransfer: false,
});

describe('buildOwnTotalsByCat', () => {
  it('skips rows with null category_id', () => {
    const rows: CategoryReportRow[] = [
      { category_id: null, category_name: null, category_kind: null, category_is_internal_transfer: null, month: '2026-07', total: '-99.00', transaction_count: 1 },
      { category_id: 1,    category_name: 'a',  category_kind: 'expense', category_is_internal_transfer: false, month: '2026-07', total: '-10.00', transaction_count: 1 },
    ];
    const m = buildOwnTotalsByCat(rows);
    expect(m.get(1)).toBeCloseTo(-10);
    expect(m.has(null as unknown as number)).toBe(false);
  });

  it('sums duplicate categories across months', () => {
    const rows: CategoryReportRow[] = [
      { category_id: 1, category_name: 'a', category_kind: 'expense', category_is_internal_transfer: false, month: '2026-07', total: '-10.00', transaction_count: 1 },
      { category_id: 1, category_name: 'a', category_kind: 'expense', category_is_internal_transfer: false, month: '2026-06', total: '-25.00', transaction_count: 2 },
    ];
    expect(buildOwnTotalsByCat(rows).get(1)).toBeCloseTo(-35);
  });
});

describe('rolledUpTotal', () => {
  const own = new Map<number, number>([[1, -100], [2, -30], [3, -20]]);

  it('leaf category with no children returns own total', () => {
    const childrenByParent = new Map<number, Category[]>();
    expect(rolledUpTotal(cat(2), own, childrenByParent)).toBe(-30);
  });

  it('parent with children rolls up direct children', () => {
    const childrenByParent = new Map<number, Category[]>([
      [1, [cat(2, 1), cat(3, 1)]],
    ]);
    expect(rolledUpTotal(cat(1), own, childrenByParent)).toBeCloseTo(-150);
  });

  it('missing entry returns 0', () => {
    const childrenByParent = new Map<number, Category[]>();
    expect(rolledUpTotal(cat(99), own, childrenByParent)).toBe(0);
  });

  it('parent with unknown children still returns own total', () => {
    const childrenByParent = new Map<number, Category[]>([
      [1, [cat(999, 1)]],
    ]);
    expect(rolledUpTotal(cat(1), own, childrenByParent)).toBe(-100);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm --prefix frontend test -- categoriesTotals`
Expected: FAIL with "Failed to load url ... categoriesTotals".

- [ ] **Step 3: Create `categoriesTotals.ts`**

Create `frontend/src/pages/Rules/categoriesTotals.ts`:

```ts
import type { Category, CategoryReportRow } from '../../api/types';

// Sum of own-category totals across the report window. `category_id == null`
// rows (uncategorized) are skipped — they're rendered separately elsewhere.
export function buildOwnTotalsByCat(report: CategoryReportRow[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of report) {
    if (r.category_id == null) continue;
    const prev = m.get(r.category_id) ?? 0;
    m.set(r.category_id, prev + Number(r.total));
  }
  return m;
}

// Category total including one level of children. Depth is capped at 1
// because the current schema only supports parent/child (no grandchildren).
export function rolledUpTotal(
  cat: Category,
  ownTotals: Map<number, number>,
  childrenByParent: Map<number, Category[]>,
): number {
  let sum = ownTotals.get(cat.id) ?? 0;
  for (const ch of childrenByParent.get(cat.id) ?? []) {
    sum += ownTotals.get(ch.id) ?? 0;
  }
  return sum;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm --prefix frontend test -- categoriesTotals`
Expected: PASS.

- [ ] **Step 5: Extract `DragGhost` to its own file**

Create `frontend/src/pages/Rules/DragGhost.tsx`. Move lines 550-572 of `Categories.tsx` verbatim:

```tsx
import { useTranslation } from 'react-i18next';
import type { Category } from '../../api/types';
import { kindBadgeClass, kindLabel } from '../../lib/categories';

export function DragGhost({
  id,
  byId,
}: {
  id: number;
  byId: Map<number, Category>;
}): JSX.Element | null {
  const { t } = useTranslation('common');
  const c = byId.get(id);
  if (!c) return null;
  return (
    <div className="surface px-3 py-2 text-sm flex items-center gap-2 shadow-lg">
      {c.color && (
        <span
          className="h-2 w-2 rounded-full border border-ink-700 shrink-0"
          style={{ backgroundColor: c.color }}
        />
      )}
      <span>{c.name}</span>
      <span className={kindBadgeClass(c.kind)}>{kindLabel(c.kind, t)}</span>
    </div>
  );
}
```

- [ ] **Step 6: Extract `CategoryTableRow` to its own file**

Create `frontend/src/pages/Rules/CategoryTableRow.tsx`. Move lines 356-548 of `Categories.tsx` verbatim (both the `UpdateMutation` type alias and the `CategoryTableRow` component):

```tsx
import { useCallback } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '../../api/client';
import type { Category, CategoryKind } from '../../api/types';
import { kindBadgeClass, kindLabel, resolveCategoryColor } from '../../lib/categories';

export type UpdateMutation = ReturnType<typeof useMutation<
  unknown, ApiError, { id: number; patch: Partial<Category> }
>>;

export function CategoryTableRow(props: {
  c: Category;
  depth: 0 | 1;
  total: number;
  hasChildren: boolean;
  parent: Category | null;
  childrenByParent: Map<number, Category[]>;
  updateCategory: UpdateMutation;
  onDelete: () => void;
  onOpenColorPicker: () => void;
}): JSX.Element {
  // ... verbatim body from current Categories.tsx lines 371-547
}
```

- [ ] **Step 7: Slim down `Categories.tsx`**

Edit `frontend/src/pages/Rules/Categories.tsx`:
1. Remove the inline `CategoryTableRow` (lines 356-548), `DragGhost` (lines 550-572), and `UpdateMutation` (lines 356-358) definitions.
2. Add imports:
   ```tsx
   import { CategoryTableRow } from './CategoryTableRow';
   import { DragGhost } from './DragGhost';
   import { buildOwnTotalsByCat, rolledUpTotal } from './categoriesTotals';
   ```
3. Replace the inline `ownTotalsByCat` builder (lines 168-173) with:
   ```tsx
   const ownTotalsByCat = useMemo(() => buildOwnTotalsByCat(report), [report]);
   ```
4. Replace the inline `rolledUpTotal` (lines 174-180) with a call site:
   - Delete the inline `const rolledUpTotal = (c: Category): number => { ... }` declaration.
   - The one caller (line 270) changes from `total={rolledUpTotal(r)}` to `total={rolledUpTotal(r, ownTotalsByCat, childrenByParent)}`.
5. `useMemo` is already imported at the top of the file — no import change needed.

- [ ] **Step 8: Run frontend suite, verify all green**

Run: `npm --prefix frontend test`
Expected: all tests pass, including `Categories.test.tsx` (494 lines), `BalanceChart.test.tsx`, and the new `categoriesTotals.test.ts`.

If `Categories.test.tsx` fails, the extraction drifted — inspect the diff of `Categories.tsx` and reconcile.

- [ ] **Step 9: Run frontend build**

Run: `npm --prefix frontend run build`
Expected: `tsc -b && vite build` succeeds.

- [ ] **Step 10: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    add frontend/src/pages/Rules/CategoryTableRow.tsx \
        frontend/src/pages/Rules/DragGhost.tsx \
        frontend/src/pages/Rules/categoriesTotals.ts \
        frontend/src/pages/Rules/Categories.tsx \
        frontend/src/pages/Rules/__tests__/categoriesTotals.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
refactor(categories): split Categories.tsx into subcomponents and unit-test the totals helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Split `backend/src/http/routes/envelopes.ts` (509 lines)

**Files:**
- Create: `backend/src/http/routes/envelopes/schemas.ts`
- Create: `backend/src/http/routes/envelopes/helpers.ts`
- Create: `backend/src/http/routes/envelopes/serializers.ts`
- Create: `backend/src/http/routes/envelopes/assignments.ts`
- Create: `backend/src/http/routes/envelopes/reallocate.ts`
- Create: `backend/src/http/routes/envelopes/settings.ts`
- Create: `backend/src/http/routes/envelopes/holds.ts`
- Create: `backend/src/http/routes/envelopes/report.ts`
- Create: `backend/src/http/routes/envelopes/index.ts`
- Delete: `backend/src/http/routes/envelopes.ts`
- Modify: `backend/src/buildServer.ts` (one import line)
- Test: `backend/tests/envelopes-serializers.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used only inside `routes/envelopes/`):
  - `serializers.ts`
    - `serializeAssignment(row: typeof envelopeAssignments.$inferSelect): { id: number; categoryId: number; month: string; amount: string; currency: string }`
    - `serializeSettings(row: typeof envelopeCategorySettings.$inferSelect): { categoryId: number; targetAmount: string | null; targetDate: string | null; targetKind: string | null; overspendPolicy: string }`
    - `serializeHold(row: typeof envelopeMonthHolds.$inferSelect): { month: string; amount: string }`
  - `schemas.ts`: `signedDecimal`, `monthStr`, `currency`, `IdParam`, `parseId(req, reply): number | null`
  - `helpers.ts`: `expenseCategoryOwned(uid: number, categoryId: number): Promise<boolean>`
  - `index.ts`: `export async function envelopesRoutes(app: FastifyInstance): Promise<void>` — same signature as today.

- [ ] **Step 1: Write the failing unit test for serializers**

Create `backend/tests/envelopes-serializers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { envelopeAssignments, envelopeCategorySettings, envelopeMonthHolds } from '../src/db/schema.js';
import {
  serializeAssignment,
  serializeHold,
  serializeSettings,
} from '../src/http/routes/envelopes/serializers.js';

type AssignmentRow = typeof envelopeAssignments.$inferSelect;
type SettingsRow  = typeof envelopeCategorySettings.$inferSelect;
type HoldRow      = typeof envelopeMonthHolds.$inferSelect;

const isoDate = (s: string) => s; // DB stores as string in this project

describe('serializeAssignment', () => {
  it('slices first-of-month DATE into wire YYYY-MM', () => {
    const row: AssignmentRow = {
      id: 42,
      userId: 1,
      categoryId: 7,
      month: isoDate('2026-07-01'),
      amount: '150.00',
      currency: 'EUR',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(serializeAssignment(row)).toEqual({
      id: 42,
      categoryId: 7,
      month: '2026-07',
      amount: '150.00',
      currency: 'EUR',
    });
  });

  it('never returns the raw first-of-month DATE (guards against slice(0,10) regression)', () => {
    const row: AssignmentRow = {
      id: 1, userId: 1, categoryId: 1,
      month: '2026-12-01', amount: '10.00', currency: 'EUR',
      createdAt: new Date(), updatedAt: new Date(),
    };
    expect(serializeAssignment(row).month).toBe('2026-12');
    expect(serializeAssignment(row).month).not.toContain('01');
  });
});

describe('serializeSettings', () => {
  it('passes target/policy fields through', () => {
    const row: SettingsRow = {
      userId: 1,
      categoryId: 3,
      targetAmount: '400.00',
      targetDate: '2027-01-01',
      targetKind: 'save_by_date',
      overspendPolicy: 'rollover_negative',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(serializeSettings(row)).toEqual({
      categoryId: 3,
      targetAmount: '400.00',
      targetDate: '2027-01-01',
      targetKind: 'save_by_date',
      overspendPolicy: 'rollover_negative',
    });
  });

  it('preserves nulls on optional targets', () => {
    const row: SettingsRow = {
      userId: 1, categoryId: 3,
      targetAmount: null, targetDate: null, targetKind: null,
      overspendPolicy: 'reallocate_manual',
      createdAt: new Date(), updatedAt: new Date(),
    };
    const s = serializeSettings(row);
    expect(s.targetAmount).toBeNull();
    expect(s.targetDate).toBeNull();
    expect(s.targetKind).toBeNull();
  });
});

describe('serializeHold', () => {
  it('slices first-of-month DATE into wire YYYY-MM', () => {
    const row: HoldRow = {
      id: 1, userId: 1,
      month: '2026-07-01', amount: '25.00',
      createdAt: new Date(), updatedAt: new Date(),
    };
    expect(serializeHold(row)).toEqual({ month: '2026-07', amount: '25.00' });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm --prefix backend test -- envelopes-serializers`
Expected: FAIL with "Cannot find module '.../envelopes/serializers.js'".

- [ ] **Step 3: Create `serializers.ts`**

Create `backend/src/http/routes/envelopes/serializers.ts`:

```ts
import type {
  envelopeAssignments,
  envelopeCategorySettings,
  envelopeMonthHolds,
} from '../../../db/schema.js';

export function serializeAssignment(row: typeof envelopeAssignments.$inferSelect) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    month: row.month.slice(0, 7),          // wire form "YYYY-MM" (DB stores first-of-month DATE)
    amount: row.amount,
    currency: row.currency,
  };
}

export function serializeSettings(row: typeof envelopeCategorySettings.$inferSelect) {
  return {
    categoryId: row.categoryId,
    targetAmount: row.targetAmount,
    targetDate: row.targetDate,
    targetKind: row.targetKind,
    overspendPolicy: row.overspendPolicy,
  };
}

export function serializeHold(row: typeof envelopeMonthHolds.$inferSelect) {
  return {
    month: row.month.slice(0, 7),          // wire form "YYYY-MM" (DB stores first-of-month DATE)
    amount: row.amount,
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm --prefix backend test -- envelopes-serializers`
Expected: PASS.

- [ ] **Step 5: Create `schemas.ts`**

Create `backend/src/http/routes/envelopes/schemas.ts`:

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export const signedDecimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

export const monthStr = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM')
  .transform((s) => `${s}-01`);

export const currency = z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code');

export const IdParam = z.object({ id: z.coerce.number().int().positive() });

export function parseId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = IdParam.safeParse(req.params);
  if (!r.success) { reply.code(400).send({ error: 'invalid id' }); return null; }
  return r.data.id;
}
```

- [ ] **Step 6: Create `helpers.ts`**

Create `backend/src/http/routes/envelopes/helpers.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { categories } from '../../../db/schema.js';

export async function expenseCategoryOwned(uid: number, categoryId: number): Promise<boolean> {
  const [row] = await db
    .select({ kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, uid)));
  return !!row && row.kind === 'expense';
}
```

- [ ] **Step 7: Create `assignments.ts`**

Create `backend/src/http/routes/envelopes/assignments.ts`. Move the assignment routes (lines 76-136 of current `envelopes.ts`) into a `registerAssignmentRoutes(app)` function. Imports:

```ts
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { envelopeAssignments } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { currency, monthStr, parseId, signedDecimal } from './schemas.js';
import { expenseCategoryOwned } from './helpers.js';
import { serializeAssignment } from './serializers.js';

export function registerAssignmentRoutes(app: FastifyInstance): void {
  const AsgListQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
  // ... verbatim body from lines 76-136
}
```

- [ ] **Step 8: Create `reallocate.ts`**

Same pattern. Move lines 140-207 into `registerReallocateRoute(app)`. Imports include `db`, `envelopeAssignments`, `userId`, `expenseCategoryOwned`, `monthStr`, `serializeAssignment`, `sql`, `and`, `eq`.

- [ ] **Step 9: Create `settings.ts`**

Move lines 211-287 into `registerSettingsRoutes(app)`. Imports include `db`, `envelopeCategorySettings`, `userId`, `expenseCategoryOwned`, `serializeSettings`, `signedDecimal`, `asc`, `and`, `eq`.

- [ ] **Step 10: Create `holds.ts`**

Move lines 291-337 into `registerHoldsRoutes(app)`. Imports include `db`, `envelopeMonthHolds`, `userId`, `monthStr`, `serializeHold`, `and`, `asc`, `eq`, `gte`, `lte`.

- [ ] **Step 11: Create `report.ts`**

Move lines 341-508 into `registerReportRoute(app)`. This is the 170-line endpoint that folds envelope-math over assignments, spend, holds, and settings. Verbatim copy; imports include `db`, `categories`, `envelopeAssignments`, `envelopeCategorySettings`, `envelopeMonthHolds`, `transactions`, `userId`, `computeCategoryBalances`, `computePool`, `and`, `eq`, `lte`, `sql`.

- [ ] **Step 12: Create `index.ts`**

Create `backend/src/http/routes/envelopes/index.ts`:

```ts
// Envelope-mode budgeting routes. Independent of /api/budgets — the two
// modes do not share tables. See docs/superpowers/specs/2026-07-16-budget-modes-design.md.
import type { FastifyInstance } from 'fastify';
import { registerAssignmentRoutes } from './assignments.js';
import { registerReallocateRoute } from './reallocate.js';
import { registerSettingsRoutes } from './settings.js';
import { registerHoldsRoutes } from './holds.js';
import { registerReportRoute } from './report.js';

export async function envelopesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);
  registerAssignmentRoutes(app);
  registerReallocateRoute(app);
  registerSettingsRoutes(app);
  registerHoldsRoutes(app);
  registerReportRoute(app);
}
```

- [ ] **Step 13: Delete the old `envelopes.ts`**

Run: `rm backend/src/http/routes/envelopes.ts`

- [ ] **Step 14: Update the import in `buildServer.ts`**

Edit `backend/src/buildServer.ts`. Change:

```ts
import { envelopesRoutes } from './http/routes/envelopes.js';
```

to:

```ts
import { envelopesRoutes } from './http/routes/envelopes/index.js';
```

- [ ] **Step 15: Run backend suite, verify all green**

Run: `npm --prefix backend test`
Expected: all tests pass, including `envelopes-route.test.ts` (386 lines), `envelope-math.test.ts` (521 lines), `envelope-schema.test.ts`, and the new `envelopes-serializers.test.ts`.

- [ ] **Step 16: Run backend build**

Run: `npm --prefix backend run build`
Expected: `tsc -p tsconfig.json && node scripts/copy-migrations.mjs` succeeds.

- [ ] **Step 17: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    add backend/src/http/routes/envelopes \
        backend/src/buildServer.ts \
        backend/tests/envelopes-serializers.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    add -u backend/src/http/routes/envelopes.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "$(cat <<'EOF'
refactor(envelopes): split envelopes.ts into per-endpoint modules and unit-test serializers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verify with `git status` (working tree clean) and `git log -3 --stat` (should show three refactor commits from this session).
