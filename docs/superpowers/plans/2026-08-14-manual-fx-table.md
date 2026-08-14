# Manual FX Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-managed FX rate table so Athena can consolidate multi-currency balances, timeseries and budget reports into one display currency.

**Architecture:** New `fx_rates` table (user-scoped, time-varying, direct pairs). A new `displayCurrency` field in the `user_settings` JSONB drives consolidation. A shared TS helper (`resolveRate` + `consolidate`) fronts every conversion. Three routes gain a `consolidated` block alongside their existing `perCurrency` shape: balance, timeseries, budget. Frontend gets a Settings UI to manage rates + display currency and rewires the Dashboard total card and BalanceChart consumer.

**Refinement of spec D7 (uniform TS-side consolidation):** the spec's Section 4 proposed doing timeseries consolidation in a SQL JOIN because "the CTE already groups by bucket." Inspection of `timeseries.ts` shows the CTE actually groups by `(account_id, bucket)`, not by bucket alone — so the JOIN would still need a fresh outer aggregation. The simpler, safer choice is uniform TS-side consolidation across all three routes, using one shared helper. This plan implements it that way.

**Tech Stack:**
- Backend: Fastify, Drizzle ORM, `drizzle-orm/pg-core`, Zod, `pg` numeric type, vitest.
- Frontend: React, React Query, Vite, vitest, existing i18n stack (`react-i18next`).
- Database: PostgreSQL (Docker OrbStack in dev; `RUN_DB_TESTS=1` gate for integration tests).

## Global Constraints

- **Never use `<input type="number">`.** Every user-typed decimal (the FX rate cell) must be `<input type="text" inputMode="decimal">` + the existing `parseDecimal()` helper from `frontend/src/lib/format.ts`. Reason: French comma vs. English dot; `type="number"` browsers reject `,` as invalid.
- **Frontend lint gate: max 300 lines per file.** New TS/TSX files must stay under this. If a file grows past it, split.
- **Attribution: Gekkotron only.** Never write real names in commits, LICENSE bylines, or file headers. Commits use `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`.
- **Public-safe.** No IPs, hostnames, secrets, or real FX rates in tests. Fixtures use obviously-fake rates like `USD→EUR = 0.9`, `GBP→EUR = 1.1`.
- **Commit directly to `main`.** No branches. Push only when explicitly asked.
- **French-first i18n.** New strings go into `frontend/src/locales/fr.json` first, then translated to `en.json`. Keys: `settings.fx.*` and `common.fx.*`.
- **Verify before push.** From repo root: `cd backend && npx vitest run` (DB-tagged tests skip locally without `RUN_DB_TESTS=1` — that's expected) and `cd frontend && npx vitest run`.
- **Frozen response contract.** Existing `perCurrency` blocks stay byte-identical — the new `consolidated` block is additive. Existing test snapshots must not need to be regenerated.

---

## File structure

**Create:**
- `backend/src/db/migrations/0038_fx_rates.sql` — the migration.
- `backend/src/domain/fx/types.ts` — shared types (`FxRate`, `PerCurrencyRow`, `ConsolidatedBlock`).
- `backend/src/domain/fx/resolve-rate.ts` — pure lookup helper.
- `backend/src/domain/fx/consolidate.ts` — pure consolidation helper.
- `backend/src/domain/fx/rates-repo.ts` — DB load helper + per-request memoization.
- `backend/src/domain/fx/__tests__/resolve-rate.test.ts`
- `backend/src/domain/fx/__tests__/consolidate.test.ts`
- `backend/src/http/routes/fx-rates.ts` — CRUD route.
- `backend/src/http/routes/__tests__/fx-rates.test.ts`
- `frontend/src/api/demo/handlers/writes/fx-rates.ts` — demo CRUD.
- `frontend/src/api/demo/handlers/reads/fx-rates.ts` — demo GET list.
- `frontend/src/pages/Settings/FxSection/index.tsx` — mount point.
- `frontend/src/pages/Settings/FxSection/DisplayCurrencyPicker.tsx`
- `frontend/src/pages/Settings/FxSection/RatesTable.tsx`
- `frontend/src/pages/Settings/FxSection/AddRateForm.tsx`
- `frontend/src/pages/Settings/FxSection/SuggestionsStrip.tsx`
- `frontend/src/pages/Settings/FxSection/__tests__/RatesTable.test.tsx`
- `frontend/src/pages/Settings/FxSection/__tests__/AddRateForm.test.tsx`
- `frontend/src/pages/Dashboard/ConsolidatedTotalCard.tsx`
- `frontend/src/pages/Dashboard/__tests__/ConsolidatedTotalCard.test.tsx`

**Modify:**
- `backend/src/db/schema.ts` — new `fxRates` table export; update the comment above `accounts` (lines 77–78) to reference the new table.
- `backend/src/domain/settings/schema.ts` — add `displayCurrency` to `SettingsSchema` and `FullSettings`.
- `backend/src/domain/settings/defaults.ts` — add `displayCurrency: null` to `DEFAULTS`.
- `backend/src/buildServer.ts` — register `fxRatesRoutes`.
- `backend/src/http/routes/reports/balance.ts` — add `consolidated` block.
- `backend/src/http/routes/reports/timeseries.ts` — add `consolidated` block.
- `backend/src/http/routes/reports/budget.ts` — add `consolidated` block.
- `frontend/src/api/demo/handlers/reads/reports.ts` (or whichever file emits balance/timeseries reads) — echo `consolidated`.
- `frontend/src/api/demo/handlers/reads/accounts.ts` — verify the balance handler's shape.
- `frontend/src/pages/Settings.tsx` — mount `<FxSection />` below existing preference blocks.
- `frontend/src/pages/Dashboard/index.tsx` — swap the per-currency card list for `ConsolidatedTotalCard` when `consolidated` is present.
- `frontend/src/components/BalanceChart/index.tsx` — read `consolidated.points` when present + toggle to raw view.
- `frontend/src/locales/fr.json` and `frontend/src/locales/en.json` — new `settings.fx.*` and `common.fx.*` namespaces.

---

## Task 1: Schema + settings preference

**Files:**
- Create: `backend/src/db/migrations/0038_fx_rates.sql`
- Modify: `backend/src/db/schema.ts` (add `fxRates` table export near the bottom, update the multi-currency comment above `accounts` at lines 77–78)
- Modify: `backend/src/domain/settings/schema.ts` (extend `SettingsSchema` and `FullSettings`)
- Modify: `backend/src/domain/settings/defaults.ts` (extend `DEFAULTS`)
- Test: `backend/src/domain/settings/__tests__/schema.test.ts` (add cases; create file if it doesn't exist)

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces:
  - Drizzle export `fxRates` with columns `{ id, userId, fromCcy, toCcy, effectiveFrom, rate, createdAt }`.
  - `SettingsSchema` accepts an optional `displayCurrency: string | null` (3-letter uppercase ISO code or `null`).
  - `FullSettings.displayCurrency: string | null` with default `null`.

- [ ] **Step 1: Write the migration**

Create `backend/src/db/migrations/0038_fx_rates.sql`:

```sql
CREATE TABLE fx_rates (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_ccy       VARCHAR(3) NOT NULL,
  to_ccy         VARCHAR(3) NOT NULL,
  effective_from DATE NOT NULL,
  rate           NUMERIC(20, 10) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fx_rates_from_ne_to CHECK (from_ccy <> to_ccy),
  CONSTRAINT fx_rates_rate_positive CHECK (rate > 0)
);

CREATE UNIQUE INDEX fx_rates_user_pair_effective_uq
  ON fx_rates (user_id, from_ccy, to_ccy, effective_from);

CREATE INDEX fx_rates_user_pair_effective_idx
  ON fx_rates (user_id, from_ccy, to_ccy, effective_from DESC);
```

- [ ] **Step 2: Add drizzle table export**

Add to `backend/src/db/schema.ts` (place near the bottom, before any views/exports at the tail):

```ts
export const fxRates = pgTable(
  'fx_rates',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromCcy: varchar('from_ccy', { length: 3 }).notNull(),
    toCcy: varchar('to_ccy', { length: 3 }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqPairEffective: uniqueIndex('fx_rates_user_pair_effective_uq').on(
      t.userId,
      t.fromCcy,
      t.toCcy,
      t.effectiveFrom,
    ),
    idxLookup: index('fx_rates_user_pair_effective_idx').on(
      t.userId,
      t.fromCcy,
      t.toCcy,
      t.effectiveFrom,
    ),
  }),
);
```

Update the comment above `accounts` (lines 77–78) to say:

```
// Multi-currency: each account has its own `currency`; per-currency aggregates
// are complemented by a `consolidated` block driven by the fx_rates table
// (see backend/src/domain/fx/).
```

- [ ] **Step 3: Extend the settings schema**

In `backend/src/domain/settings/schema.ts`, add inside the `.object({...})`:

```ts
displayCurrency: z
  .union([z.string().regex(/^[A-Z]{3}$/), z.null()])
  .optional(),
```

Extend `FullSettings`:

```ts
displayCurrency: string | null;
```

In `backend/src/domain/settings/defaults.ts`:

```ts
displayCurrency: null,
```

Since `DEFAULTS` is `as const` and the union with `null` changes the literal type, also adjust the type export at the bottom of `defaults.ts`:

```ts
export type DisplayCurrency = string | null;
```

- [ ] **Step 4: Write the failing settings test**

Create or extend `backend/src/domain/settings/__tests__/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SettingsSchema, mergeSettings } from '../schema.js';

describe('settings — displayCurrency', () => {
  it('accepts a 3-letter uppercase code', () => {
    const parsed = SettingsSchema.safeParse({ displayCurrency: 'EUR' });
    expect(parsed.success).toBe(true);
  });

  it('accepts null (per-currency mode)', () => {
    const parsed = SettingsSchema.safeParse({ displayCurrency: null });
    expect(parsed.success).toBe(true);
  });

  it('rejects lowercase and non-3-letter codes', () => {
    expect(SettingsSchema.safeParse({ displayCurrency: 'eur' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ displayCurrency: 'EU' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ displayCurrency: 'EUROS' }).success).toBe(false);
  });

  it('defaults to null when absent from stored JSONB', () => {
    const merged = mergeSettings({});
    expect(merged.displayCurrency).toBeNull();
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run src/domain/settings/__tests__/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npx vitest run`
Expected: PASS (DB-tagged files skip without `RUN_DB_TESTS=1`).

- [ ] **Step 7: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/db/migrations/0038_fx_rates.sql \
  backend/src/db/schema.ts \
  backend/src/domain/settings/schema.ts \
  backend/src/domain/settings/defaults.ts \
  backend/src/domain/settings/__tests__/schema.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(fx): schema + displayCurrency preference"
```

---

## Task 2: Shared FX helper (pure TS)

**Files:**
- Create: `backend/src/domain/fx/types.ts`
- Create: `backend/src/domain/fx/resolve-rate.ts`
- Create: `backend/src/domain/fx/consolidate.ts`
- Test: `backend/src/domain/fx/__tests__/resolve-rate.test.ts`
- Test: `backend/src/domain/fx/__tests__/consolidate.test.ts`

**Interfaces:**
- Consumes: nothing (pure helpers).
- Produces:
  - `type FxRate = { fromCcy: string; toCcy: string; effectiveFrom: string; rate: string }` — `rate` and `effectiveFrom` are strings so callers can pass DB rows directly.
  - `resolveRate(rates: FxRate[], from: string, to: string, at: string): number | null`
  - `type ConsolidatedTotals<K extends string> = { display: string; totals: Record<K, string>; unmapped: Array<{ currency: string } & Record<K, string>> }`
  - `consolidate<K extends string>(rows: Array<{ currency: string } & Record<K, string>>, display: string, rates: FxRate[], at: string, keys: readonly K[]): ConsolidatedTotals<K>`

- [ ] **Step 1: Write the types**

Create `backend/src/domain/fx/types.ts`:

```ts
export type FxRate = {
  fromCcy: string;
  toCcy: string;
  effectiveFrom: string; // ISO YYYY-MM-DD
  rate: string;          // stringified numeric to preserve precision
};

export type ConsolidatedTotals<K extends string> = {
  display: string;
  totals: Record<K, string>; // stringified numeric, 2-decimal quantized
  unmapped: Array<{ currency: string } & Record<K, string>>;
};
```

- [ ] **Step 2: Write the failing resolveRate tests**

Create `backend/src/domain/fx/__tests__/resolve-rate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveRate } from '../resolve-rate.js';
import type { FxRate } from '../types.js';

const R = (fromCcy: string, toCcy: string, effectiveFrom: string, rate: string): FxRate =>
  ({ fromCcy, toCcy, effectiveFrom, rate });

describe('resolveRate', () => {
  it('returns 1 when from === to', () => {
    expect(resolveRate([], 'EUR', 'EUR', '2026-01-01')).toBe(1);
  });

  it('finds an exact-date rate', () => {
    const rates = [R('USD', 'EUR', '2026-01-01', '0.9')];
    expect(resolveRate(rates, 'USD', 'EUR', '2026-01-01')).toBe(0.9);
  });

  it('finds the most recent rate on or before the target date', () => {
    const rates = [
      R('USD', 'EUR', '2026-01-01', '0.9'),
      R('USD', 'EUR', '2026-06-01', '0.85'),
    ];
    expect(resolveRate(rates, 'USD', 'EUR', '2026-03-15')).toBe(0.9);
    expect(resolveRate(rates, 'USD', 'EUR', '2026-07-01')).toBe(0.85);
  });

  it('returns null when no rate exists for the pair', () => {
    expect(resolveRate([], 'USD', 'EUR', '2026-01-01')).toBeNull();
  });

  it('returns null when all effective dates are after the target', () => {
    const rates = [R('USD', 'EUR', '2026-06-01', '0.85')];
    expect(resolveRate(rates, 'USD', 'EUR', '2026-01-01')).toBeNull();
  });

  it('does not derive the reverse pair from a stored (from,to) row', () => {
    const rates = [R('USD', 'EUR', '2026-01-01', '0.9')];
    expect(resolveRate(rates, 'EUR', 'USD', '2026-01-01')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/domain/fx/__tests__/resolve-rate.test.ts`
Expected: FAIL with "cannot find module '../resolve-rate.js'".

- [ ] **Step 4: Implement resolveRate**

Create `backend/src/domain/fx/resolve-rate.ts`:

```ts
import type { FxRate } from './types.js';

export function resolveRate(
  rates: FxRate[],
  from: string,
  to: string,
  at: string,
): number | null {
  if (from === to) return 1;
  let best: FxRate | null = null;
  for (const r of rates) {
    if (r.fromCcy !== from || r.toCcy !== to) continue;
    if (r.effectiveFrom > at) continue;
    if (best === null || r.effectiveFrom > best.effectiveFrom) {
      best = r;
    }
  }
  return best === null ? null : Number(best.rate);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/domain/fx/__tests__/resolve-rate.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 6: Write the failing consolidate tests**

Create `backend/src/domain/fx/__tests__/consolidate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { consolidate } from '../consolidate.js';
import type { FxRate } from '../types.js';

const R = (fromCcy: string, toCcy: string, effectiveFrom: string, rate: string): FxRate =>
  ({ fromCcy, toCcy, effectiveFrom, rate });

describe('consolidate', () => {
  const KEYS = ['total', 'available'] as const;

  it('converts every row when all rates exist', () => {
    const rows = [
      { currency: 'EUR', total: '100.00', available: '100.00' },
      { currency: 'USD', total: '100.00', available: '50.00' },
    ];
    const rates = [R('USD', 'EUR', '2026-01-01', '0.9')];
    const out = consolidate(rows, 'EUR', rates, '2026-06-01', KEYS);
    expect(out.display).toBe('EUR');
    expect(out.totals.total).toBe('190.00');
    expect(out.totals.available).toBe('145.00');
    expect(out.unmapped).toEqual([]);
  });

  it('lists unconverted rows under unmapped', () => {
    const rows = [
      { currency: 'EUR', total: '100.00', available: '100.00' },
      { currency: 'GBP', total: '50.00', available: '50.00' },
    ];
    const out = consolidate(rows, 'EUR', [], '2026-06-01', KEYS);
    expect(out.totals.total).toBe('100.00');
    expect(out.unmapped).toEqual([
      { currency: 'GBP', total: '50.00', available: '50.00' },
    ]);
  });

  it('short-circuits identity conversion without a rate row', () => {
    const rows = [{ currency: 'EUR', total: '100.00', available: '100.00' }];
    const out = consolidate(rows, 'EUR', [], '2026-06-01', KEYS);
    expect(out.totals.total).toBe('100.00');
    expect(out.unmapped).toEqual([]);
  });

  it('handles an empty perCurrency list', () => {
    const out = consolidate([], 'EUR', [], '2026-06-01', KEYS);
    expect(out.totals.total).toBe('0.00');
    expect(out.totals.available).toBe('0.00');
    expect(out.unmapped).toEqual([]);
  });

  it('quantizes to 2 decimals using half-up rounding', () => {
    const rows = [{ currency: 'USD', total: '100.005', available: '99.994' }];
    const rates = [R('USD', 'EUR', '2026-01-01', '1')];
    const out = consolidate(rows, 'EUR', rates, '2026-06-01', ['total', 'available'] as const);
    expect(out.totals.total).toBe('100.01');
    expect(out.totals.available).toBe('99.99');
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/domain/fx/__tests__/consolidate.test.ts`
Expected: FAIL with "cannot find module '../consolidate.js'".

- [ ] **Step 8: Implement consolidate**

Create `backend/src/domain/fx/consolidate.ts`:

```ts
import { resolveRate } from './resolve-rate.js';
import type { FxRate, ConsolidatedTotals } from './types.js';

// Half-up rounding to 2 decimals via a scaled integer round.
function quantize2(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function consolidate<K extends string>(
  rows: Array<{ currency: string } & Record<K, string>>,
  display: string,
  rates: FxRate[],
  at: string,
  keys: readonly K[],
): ConsolidatedTotals<K> {
  const running: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  const unmapped: Array<{ currency: string } & Record<K, string>> = [];

  for (const row of rows) {
    const rate = resolveRate(rates, row.currency, display, at);
    if (rate === null) {
      unmapped.push(row);
      continue;
    }
    for (const k of keys) {
      running[k] += Number(row[k]) * rate;
    }
  }

  const totals = Object.fromEntries(
    keys.map((k) => [k, quantize2(running[k])]),
  ) as Record<K, string>;

  return { display, totals, unmapped };
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/domain/fx/__tests__/consolidate.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 10: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/domain/fx/types.ts \
  backend/src/domain/fx/resolve-rate.ts \
  backend/src/domain/fx/consolidate.ts \
  backend/src/domain/fx/__tests__/resolve-rate.test.ts \
  backend/src/domain/fx/__tests__/consolidate.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(fx): pure resolveRate + consolidate helpers"
```

---

## Task 3: Rates repo + CRUD route

**Files:**
- Create: `backend/src/domain/fx/rates-repo.ts`
- Create: `backend/src/http/routes/fx-rates.ts`
- Test: `backend/src/http/routes/__tests__/fx-rates.test.ts`
- Modify: `backend/src/buildServer.ts` (register route)

**Interfaces:**
- Consumes: `FxRate` type from Task 2.
- Produces:
  - `loadUserRates(uid: number): Promise<FxRate[]>` — a plain fetcher (no in-request cache at this layer; callers memoize via `req._fxRatesPromise` starting Task 4).
  - HTTP `/api/fx-rates`:
    - `GET → { rates: Array<{ id, from, to, effectiveFrom, rate }> }`
    - `POST body { from, to, effectiveFrom, rate } → 201 { rate: {...} }`
    - `PATCH /:id body { rate?, effectiveFrom? } → { rate: {...} }`
    - `DELETE /:id → 204`
  - Duplicate insert/update → HTTP 409 `{ error: 'conflict', code: 'DUPLICATE_RATE' }`.

- [ ] **Step 1: Write the rates repo**

Create `backend/src/domain/fx/rates-repo.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fxRates } from '../../db/schema.js';
import type { FxRate } from './types.js';

export async function loadUserRates(uid: number): Promise<FxRate[]> {
  const rows = await db
    .select({
      fromCcy: fxRates.fromCcy,
      toCcy: fxRates.toCcy,
      effectiveFrom: fxRates.effectiveFrom,
      rate: fxRates.rate,
    })
    .from(fxRates)
    .where(eq(fxRates.userId, uid));
  return rows.map((r) => ({
    fromCcy: r.fromCcy,
    toCcy: r.toCcy,
    effectiveFrom: String(r.effectiveFrom),
    rate: String(r.rate),
  }));
}
```

- [ ] **Step 2: Write the failing route tests**

Create `backend/src/http/routes/__tests__/fx-rates.test.ts`. This file is DB-tagged; it will only run under `RUN_DB_TESTS=1`. Use the same test-app helper other route tests use in `backend/src/http/routes/__tests__/` (locate it and follow the pattern):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { withDbApp } from './_helpers.js'; // pattern used by existing route tests

describe.runIf(process.env.RUN_DB_TESTS === '1')('/api/fx-rates', () => {
  beforeEach(async () => {
    // helper resets DB + seeds a user; adjust to match the actual helper API.
  });

  it('GET returns the seeded rate list', async () => {
    await withDbApp(async ({ app, request, uid }) => {
      // pre-seed one rate via the DB layer or via POST
      await request({ method: 'POST', url: '/api/fx-rates', payload: {
        from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9',
      }});
      const res = await request({ method: 'GET', url: '/api/fx-rates' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rates).toHaveLength(1);
      expect(body.rates[0]).toMatchObject({
        from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9000000000',
      });
    });
  });

  it('POST rejects lowercase codes and from == to', async () => {
    await withDbApp(async ({ request }) => {
      const bad1 = await request({ method: 'POST', url: '/api/fx-rates', payload: {
        from: 'usd', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9',
      }});
      expect(bad1.statusCode).toBe(400);
      const bad2 = await request({ method: 'POST', url: '/api/fx-rates', payload: {
        from: 'EUR', to: 'EUR', effectiveFrom: '2026-01-01', rate: '1',
      }});
      expect(bad2.statusCode).toBe(400);
    });
  });

  it('POST returns 409 on duplicate (user, from, to, effectiveFrom)', async () => {
    await withDbApp(async ({ request }) => {
      const body = { from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' };
      const ok = await request({ method: 'POST', url: '/api/fx-rates', payload: body });
      expect(ok.statusCode).toBe(201);
      const dup = await request({ method: 'POST', url: '/api/fx-rates', payload: body });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().code).toBe('DUPLICATE_RATE');
    });
  });

  it('PATCH updates rate and effectiveFrom', async () => {
    await withDbApp(async ({ request }) => {
      const created = await request({ method: 'POST', url: '/api/fx-rates', payload: {
        from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9',
      }});
      const id = created.json().rate.id;
      const patched = await request({
        method: 'PATCH', url: `/api/fx-rates/${id}`,
        payload: { rate: '0.85' },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().rate.rate).toBe('0.8500000000');
    });
  });

  it('DELETE removes the row', async () => {
    await withDbApp(async ({ request }) => {
      const created = await request({ method: 'POST', url: '/api/fx-rates', payload: {
        from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9',
      }});
      const id = created.json().rate.id;
      const del = await request({ method: 'DELETE', url: `/api/fx-rates/${id}` });
      expect(del.statusCode).toBe(204);
      const list = await request({ method: 'GET', url: '/api/fx-rates' });
      expect(list.json().rates).toHaveLength(0);
    });
  });
});
```

If `_helpers.js` doesn't exist in the tests folder, use the same pattern the existing route tests use (search `backend/src/http/routes/**/__tests__` for the first `.test.ts` file that boots an app and copy its setup).

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run src/http/routes/__tests__/fx-rates.test.ts` (locally, skip this step if OrbStack is down — the CI will run it).
Expected: FAIL (route not yet registered).

- [ ] **Step 4: Implement the CRUD route**

Create `backend/src/http/routes/fx-rates.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { fxRates } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';

const CcyCode = z.string().regex(/^[A-Z]{3}$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Rate = z
  .string()
  .regex(/^\d+(\.\d{1,10})?$/)
  .refine((s) => Number(s) > 0, 'rate must be > 0');

const CreateBody = z.object({
  from: CcyCode,
  to: CcyCode,
  effectiveFrom: IsoDate,
  rate: Rate,
}).refine((v) => v.from !== v.to, { path: ['to'], message: 'from and to must differ' });

const PatchBody = z.object({
  rate: Rate.optional(),
  effectiveFrom: IsoDate.optional(),
}).refine((v) => v.rate !== undefined || v.effectiveFrom !== undefined, {
  message: 'nothing to update',
});

function shape(row: typeof fxRates.$inferSelect) {
  return {
    id: row.id,
    from: row.fromCcy,
    to: row.toCcy,
    effectiveFrom: String(row.effectiveFrom),
    rate: String(row.rate),
  };
}

export async function fxRatesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/fx-rates', async (req) => {
    const uid = userId(req);
    const rows = await db.select().from(fxRates).where(eq(fxRates.userId, uid));
    return {
      rates: rows
        .sort((a, b) =>
          a.fromCcy.localeCompare(b.fromCcy) ||
          a.toCcy.localeCompare(b.toCcy) ||
          String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)),
        )
        .map(shape),
    };
  });

  app.post('/api/fx-rates', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { from, to, effectiveFrom, rate } = parsed.data;
    try {
      const [row] = await db
        .insert(fxRates)
        .values({ userId: uid, fromCcy: from, toCcy: to, effectiveFrom, rate })
        .returning();
      return reply.code(201).send({ rate: shape(row) });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
        return reply.code(409).send({ error: 'conflict', code: 'DUPLICATE_RATE' });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/fx-rates/:id', async (req, reply) => {
    const uid = userId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'invalid id' });
    }
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    try {
      const [row] = await db
        .update(fxRates)
        .set(parsed.data)
        .where(and(eq(fxRates.id, id), eq(fxRates.userId, uid)))
        .returning();
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return { rate: shape(row) };
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
        return reply.code(409).send({ error: 'conflict', code: 'DUPLICATE_RATE' });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/fx-rates/:id', async (req, reply) => {
    const uid = userId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'invalid id' });
    }
    await db.delete(fxRates).where(and(eq(fxRates.id, id), eq(fxRates.userId, uid)));
    return reply.code(204).send();
  });
}
```

- [ ] **Step 5: Register the route**

In `backend/src/buildServer.ts`, add an import next to the other route imports:

```ts
import { fxRatesRoutes } from './http/routes/fx-rates.js';
```

And in the authenticated-routes block (after `savingsGoalsRoutes`):

```ts
await app.register(fxRatesRoutes);
```

- [ ] **Step 6: Run route tests to verify they pass (CI only if OrbStack is down)**

Run: `cd backend && RUN_DB_TESTS=1 npx vitest run src/http/routes/__tests__/fx-rates.test.ts`
Expected: PASS. If OrbStack is not running, skip this — CI will run it. Do NOT launch OrbStack (per project rule).

- [ ] **Step 7: Run the full backend suite (locally, DB tests skip)**

Run: `cd backend && npx vitest run`
Expected: PASS (DB-tagged files skip cleanly).

- [ ] **Step 8: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/domain/fx/rates-repo.ts \
  backend/src/http/routes/fx-rates.ts \
  backend/src/http/routes/__tests__/fx-rates.test.ts \
  backend/src/buildServer.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(fx): CRUD route for user-managed rate table"
```

---

## Task 4: Balance report — consolidated block

**Files:**
- Modify: `backend/src/http/routes/reports/balance.ts`
- Test: `backend/src/http/routes/reports/__tests__/balance.test.ts` (create or extend)

**Interfaces:**
- Consumes: `consolidate()` from Task 2, `loadUserRates()` from Task 3, settings loader for `displayCurrency`.
- Produces: `GET /api/reports/balance?display=<ccy>?` returns
  ```
  {
    perCurrency: [...unchanged...],
    consolidated: {
      display: string,
      total: string, available: string, invested: string,
      unmapped: Array<{ currency, total, available, invested }>,
    } | null,
  }
  ```
  Behavior:
  - `?display=none` → `consolidated: null`.
  - `?display=XYZ` or no query + `settings.displayCurrency` set → compute.
  - No query + `settings.displayCurrency = null` → `consolidated: null`.

- [ ] **Step 1: Write the failing test**

Create or extend `backend/src/http/routes/reports/__tests__/balance.test.ts`. This may be a DB integration test — copy the pattern from a neighboring `reports/__tests__/*.test.ts`. If none exists yet, write a pure route test that mocks `db.execute` and `loadUserRates`.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { build } from '../../../../buildServer.js';
import { db } from '../../../../db/client.js';
import { loadUserRates } from '../../../../domain/fx/rates-repo.js';
import { loadUserDisplayCurrency } from '../../../../domain/settings/loader.js';

vi.mock('../../../../db/client.js', () => ({
  db: { execute: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  dbDriver: 'pg',
}));
vi.mock('../../../../domain/fx/rates-repo.js', () => ({ loadUserRates: vi.fn() }));
vi.mock('../../../../domain/settings/loader.js', () => ({ loadUserDisplayCurrency: vi.fn() }));
vi.mock('../../plugins/auth.js', () => ({
  authPlugin: async () => {},
  userId: () => 1,
}));

describe('/api/reports/balance — consolidated block', () => {
  const perCurrencyRows = [
    { currency: 'EUR', total: '100.00', available: '100.00', invested: '0.00', account_count: 1 },
    { currency: 'USD', total: '100.00', available: '50.00', invested: '0.00', account_count: 1 },
  ];

  beforeEach(() => {
    vi.mocked(db.execute).mockResolvedValue({ rows: perCurrencyRows } as never);
    vi.mocked(loadUserRates).mockResolvedValue([
      { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2020-01-01', rate: '0.9' },
    ]);
    vi.mocked(loadUserDisplayCurrency).mockResolvedValue(null);
  });

  it('returns consolidated: null when no display currency is requested and settings has none', async () => {
    const app = await build({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/reports/balance' });
    expect(res.statusCode).toBe(200);
    expect(res.json().consolidated).toBeNull();
    await app.close();
  });

  it('computes consolidated total using the requested display currency', async () => {
    const app = await build({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/reports/balance?display=EUR' });
    const body = res.json();
    expect(body.consolidated.display).toBe('EUR');
    expect(body.consolidated.total).toBe('190.00');
    expect(body.consolidated.available).toBe('145.00');
    expect(body.consolidated.unmapped).toEqual([]);
    await app.close();
  });

  it('falls back to the user setting when no query param is given', async () => {
    vi.mocked(loadUserDisplayCurrency).mockResolvedValue('EUR');
    const app = await build({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/reports/balance' });
    expect(res.json().consolidated.total).toBe('190.00');
    await app.close();
  });

  it('lists unmapped rows when a rate is missing', async () => {
    vi.mocked(loadUserRates).mockResolvedValue([]);
    const app = await build({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/reports/balance?display=EUR' });
    const body = res.json();
    expect(body.consolidated.total).toBe('100.00');
    expect(body.consolidated.unmapped).toEqual([
      { currency: 'USD', total: '100.00', available: '50.00', invested: '0.00', account_count: 1 },
    ]);
    await app.close();
  });
});
```

Notes on the mock structure:
- `build()` runs the full server registration path; mocking `db` and the two seams above is enough to isolate the balance handler.
- The `authPlugin` mock replaces auth wiring so the handler runs as user id `1` without a real session.
- Adjust import paths (the `../../../../` depth) to whatever the folder layout resolves at test-write time. If `pool` isn't exported from `db/client.js`, drop it from the mock.
- If a neighboring reports test already mocks the same seams differently, match its shape rather than diverging.

Because balance.ts embeds the SQL inline and reads the user's settings from Fastify auth context, the test needs to stub `loadUserRates` and the settings source. Adjust to match how the route reads settings after Step 2 lands.

- [ ] **Step 2: Add a per-request settings loader accessor**

Balance's route needs the user's `displayCurrency`. There is no existing helper — the pattern to follow is a small local helper in the route file:

```ts
async function loadUserDisplayCurrency(uid: number): Promise<string | null> {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  const merged = mergeSettings(row?.settings ?? {});
  return merged.displayCurrency;
}
```

- [ ] **Step 3: Modify `balance.ts`**

At the top:

```ts
import { and, eq, sql } from 'drizzle-orm';
import { userSettings } from '../../../db/schema.js';
import { mergeSettings } from '../../../domain/settings/schema.js';
import { loadUserRates } from '../../../domain/fx/rates-repo.js';
import { consolidate } from '../../../domain/fx/consolidate.js';
```

Inside the handler, after the existing `rows` fetch and before the `return`, add:

```ts
const q = req.query as { display?: string } | undefined;
const displayParam = q?.display;

let display: string | null;
if (displayParam === undefined) {
  display = await loadUserDisplayCurrency(uid);
} else if (displayParam === 'none') {
  display = null;
} else if (/^[A-Z]{3}$/.test(displayParam)) {
  display = displayParam;
} else {
  return reply.code(400).send({ error: 'invalid display currency' });
}

let consolidated:
  | {
      display: string;
      total: string;
      available: string;
      invested: string;
      unmapped: Array<{ currency: string; total: string; available: string; invested: string }>;
    }
  | null = null;

if (display !== null) {
  const rates = await loadUserRates(uid);
  const today = new Date().toISOString().slice(0, 10);
  const KEYS = ['total', 'available', 'invested'] as const;
  const out = consolidate(rows.rows, display, rates, today, KEYS);
  consolidated = {
    display: out.display,
    total: out.totals.total,
    available: out.totals.available,
    invested: out.totals.invested,
    unmapped: out.unmapped,
  };
}

return { perCurrency: rows.rows, consolidated };
```

Add `reply` to the handler signature (it isn't there today) and add the local `loadUserDisplayCurrency` helper defined in Step 2.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd backend && npx vitest run src/http/routes/reports/__tests__/balance.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/http/routes/reports/balance.ts \
  backend/src/http/routes/reports/__tests__/balance.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(fx): balance report — consolidated block"
```

---

## Task 5: Timeseries report — consolidated block (TS-side)

**Files:**
- Modify: `backend/src/http/routes/reports/timeseries.ts`
- Test: `backend/src/http/routes/reports/__tests__/timeseries.test.ts` (create or extend)

**Interfaces:**
- Consumes: `resolveRate()` from Task 2, `loadUserRates()` from Task 3.
- Produces: `GET /api/reports/timeseries?display=<ccy>?` returns
  ```
  {
    points: [...unchanged per-account per-bucket...],
    consolidated: {
      display: string,
      points: Array<{ bucket: string; total: string; unmapped: string[] }>,
    } | null,
  }
  ```

- [ ] **Step 1: Add a small pure aggregator + test**

Create `backend/src/domain/fx/aggregate-timeseries.ts`:

```ts
import { resolveRate } from './resolve-rate.js';
import type { FxRate } from './types.js';

export function aggregateTimeseriesByBucket(
  points: Array<{ currency: string; bucket: string; cumulative: string }>,
  display: string,
  rates: FxRate[],
): Array<{ bucket: string; total: string; unmapped: string[] }> {
  const byBucket = new Map<string, { total: number; unmapped: Set<string> }>();
  for (const p of points) {
    let entry = byBucket.get(p.bucket);
    if (!entry) {
      entry = { total: 0, unmapped: new Set() };
      byBucket.set(p.bucket, entry);
    }
    const rate = resolveRate(rates, p.currency, display, p.bucket);
    if (rate === null) {
      entry.unmapped.add(p.currency);
      continue;
    }
    entry.total += Number(p.cumulative) * rate;
  }
  const buckets = Array.from(byBucket.entries()).sort(([a], [b]) => a.localeCompare(b));
  return buckets.map(([bucket, { total, unmapped }]) => ({
    bucket,
    total: (Math.round((total + Number.EPSILON) * 100) / 100).toFixed(2),
    unmapped: Array.from(unmapped).sort(),
  }));
}
```

Create `backend/src/domain/fx/__tests__/aggregate-timeseries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregateTimeseriesByBucket } from '../aggregate-timeseries.js';

describe('aggregateTimeseriesByBucket', () => {
  it('sums converted balances into one series per bucket', () => {
    const points = [
      { currency: 'EUR', bucket: '2026-01-01', cumulative: '100.00' },
      { currency: 'USD', bucket: '2026-01-01', cumulative: '100.00' },
      { currency: 'EUR', bucket: '2026-02-01', cumulative: '110.00' },
      { currency: 'USD', bucket: '2026-02-01', cumulative: '100.00' },
    ];
    const rates = [
      { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' },
      { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2026-02-01', rate: '1.0' },
    ];
    const out = aggregateTimeseriesByBucket(points, 'EUR', rates);
    expect(out).toEqual([
      { bucket: '2026-01-01', total: '190.00', unmapped: [] },
      { bucket: '2026-02-01', total: '210.00', unmapped: [] },
    ]);
  });

  it('uses the rate effective at the bucket date (historical stability)', () => {
    const points = [{ currency: 'USD', bucket: '2026-01-15', cumulative: '100.00' }];
    const rates = [
      { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' },
      { fromCcy: 'USD', toCcy: 'EUR', effectiveFrom: '2026-06-01', rate: '0.5' },
    ];
    const out = aggregateTimeseriesByBucket(points, 'EUR', rates);
    expect(out[0].total).toBe('90.00');
  });

  it('lists unmapped currencies per bucket without dropping the point', () => {
    const points = [
      { currency: 'EUR', bucket: '2026-01-01', cumulative: '100.00' },
      { currency: 'GBP', bucket: '2026-01-01', cumulative: '50.00' },
    ];
    const out = aggregateTimeseriesByBucket(points, 'EUR', []);
    expect(out[0].total).toBe('100.00');
    expect(out[0].unmapped).toEqual(['GBP']);
  });
});
```

Run the tests to verify — they should fail then pass:

```bash
cd backend && npx vitest run src/domain/fx/__tests__/aggregate-timeseries.test.ts
```

- [ ] **Step 2: Modify `timeseries.ts`**

In the handler:

```ts
// after the `rows` fetch:
const displayParam = (req.query as { display?: string })?.display;

let display: string | null;
if (displayParam === undefined) {
  display = await loadUserDisplayCurrency(uid); // shared loader (see Step 2 below)
} else if (displayParam === 'none') {
  display = null;
} else if (/^[A-Z]{3}$/.test(displayParam)) {
  display = displayParam;
} else {
  return reply.code(400).send({ error: 'invalid display currency' });
}

let consolidated: { display: string; points: Array<{ bucket: string; total: string; unmapped: string[] }> } | null = null;
if (display !== null) {
  const rates = await loadUserRates(uid);
  const points = aggregateTimeseriesByBucket(rows.rows, display, rates);
  consolidated = { display, points };
}

return { points: rows.rows, consolidated };
```

Extract `loadUserDisplayCurrency` from `balance.ts` into a shared module: create `backend/src/domain/settings/loader.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userSettings } from '../../db/schema.js';
import { mergeSettings } from './schema.js';

export async function loadUserDisplayCurrency(uid: number): Promise<string | null> {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  return mergeSettings(row?.settings ?? {}).displayCurrency;
}
```

And update `balance.ts` to import from this shared module instead of the local helper (a small refactor — replace the local `loadUserDisplayCurrency` definition with an import).

- [ ] **Step 3: Write the failing timeseries route test**

Create or extend `backend/src/http/routes/reports/__tests__/timeseries.test.ts`. Mock the same seams as in Task 4's balance test. Assert that with `?display=EUR` the response includes `consolidated.points` matching what the pure aggregator returns.

- [ ] **Step 4: Run the tests to verify**

Run: `cd backend && npx vitest run src/http/routes/reports/__tests__/ src/domain/fx/__tests__/aggregate-timeseries.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/domain/fx/aggregate-timeseries.ts \
  backend/src/domain/fx/__tests__/aggregate-timeseries.test.ts \
  backend/src/domain/settings/loader.ts \
  backend/src/http/routes/reports/balance.ts \
  backend/src/http/routes/reports/timeseries.ts \
  backend/src/http/routes/reports/__tests__/timeseries.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(fx): timeseries report — consolidated block (TS-side)"
```

---

## Task 6: Budget report — consolidated block

**Files:**
- Modify: `backend/src/http/routes/reports/budget.ts`
- Test: `backend/src/http/routes/reports/__tests__/budget.test.ts` (create or extend)

**Interfaces:**
- Consumes: `consolidate()` from Task 2, `loadUserRates()` from Task 3, `loadUserDisplayCurrency()` from Task 5.
- Produces: `GET /api/reports/budget?display=<ccy>?` grows a `consolidated` block over the numeric fields the budget response already emits per currency (whichever they are — the task's Step 1 reads the file to enumerate them).

- [ ] **Step 1: Enumerate the budget response's per-currency numeric fields**

Open `backend/src/http/routes/reports/budget.ts` and identify:
- The exact response shape.
- Which fields are per-currency numeric strings suitable for consolidation (e.g., `limit`, `spent`, `remaining`, or whichever keys the current response emits).

If the response is one row per budget (each with its own currency) rather than a `perCurrency` block, `consolidate()` still applies — just treat each budget row as a single-row perCurrency call, or pre-group by currency and consolidate. Choose based on what the response consumer (`frontend/src/lib/useBudgets.ts` and the budget page) actually reads.

- [ ] **Step 2: Write the failing test**

Follow the pattern from Task 4. Mock db.execute + loadUserRates. Cover: `?display=EUR`, `?display=none`, no query + settings null, no query + settings set.

- [ ] **Step 3: Add the `consolidated` block**

Wire in `display` resolution (identical to balance/timeseries) and `consolidate()` over the numeric field list from Step 1. For each budget row that has a period, use the end of that period as the `at` date (fall back to today if the row has no explicit period end).

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run src/http/routes/reports/__tests__/budget.test.ts`
Expected: PASS.

Run: `cd backend && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  backend/src/http/routes/reports/budget.ts \
  backend/src/http/routes/reports/__tests__/budget.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(fx): budget report — consolidated block"
```

---

## Task 7: Demo mode — CRUD + reads parity

**Files:**
- Create: `frontend/src/api/demo/handlers/writes/fx-rates.ts`
- Create: `frontend/src/api/demo/handlers/reads/fx-rates.ts`
- Modify: whichever file registers demo handlers (`frontend/src/api/demo/seed.ts` and/or a router file — search the demo folder to locate).
- Modify: `frontend/src/api/demo/handlers/reads/accounts.ts` (or whichever handler emits the balance response) — add `consolidated`.
- Modify: whichever handler emits `/api/reports/timeseries` and `/api/reports/budget` in demo mode — add `consolidated`.
- Test: `frontend/src/api/demo/__tests__/fx-rates.test.ts` (new)
- Test: extend `frontend/src/api/demo/__tests__/reads.test.ts` (add `consolidated` assertions)

**Interfaces:**
- Consumes: the demo store's user/state layer (search `frontend/src/api/demo/seed.ts` and existing writes handlers).
- Produces: demo endpoints for `/api/fx-rates` (GET/POST/PATCH/DELETE) and a `consolidated` block on the demo balance/timeseries/budget reads. Demo `PATCH /api/settings` already exists — extend the demo state to store `displayCurrency` there.

- [ ] **Step 1: Study the demo layer**

Read `frontend/src/api/demo/seed.ts` and the existing `writes/` and `reads/` handlers to learn:
- Where the in-memory user state lives.
- How settings are stored today (grep for `dashboardChartScope` in demo files).
- The router/dispatcher pattern for new endpoints.

- [ ] **Step 2: Add demo state for FX rates + displayCurrency**

Extend the demo state with `fxRates: FxRate[]` and, in the settings blob, `displayCurrency: string | null`.

- [ ] **Step 3: Write demo CRUD handlers**

Mirror the backend contract. Use a shared TS FX helper — either export the backend one from a place both can import (safer: duplicate the two small pure functions into `frontend/src/lib/fx.ts`, since backend and frontend can't share source freely).

Create `frontend/src/lib/fx.ts` with the same `resolveRate`, `consolidate`, and `aggregateTimeseriesByBucket` implementations as their backend counterparts (Tasks 2 and 5). Duplicated on purpose — cross-package source sharing isn't set up. Keep the code byte-identical so drift is easy to spot.

Add a unit test for the frontend copy: `frontend/src/lib/__tests__/fx.test.ts` mirroring Task 2's tests, so the duplication stays honest.

- [ ] **Step 4: Add `consolidated` in demo reads**

For the three demo read handlers (balance, timeseries, budget), fold `perCurrency` (or per-account timeseries points) through `consolidate` / the aggregator, using the demo `displayCurrency` and `fxRates`.

- [ ] **Step 5: Extend demo tests**

Extend `frontend/src/api/demo/__tests__/reads.test.ts` to assert:
- `consolidated: null` when `displayCurrency` is null.
- `consolidated.total` matches the expected sum when `displayCurrency = 'EUR'` and rates are seeded.
- `consolidated.unmapped` lists uncovered currencies.

Add `frontend/src/api/demo/__tests__/fx-rates.test.ts` covering GET/POST/PATCH/DELETE + 409 on duplicate.

- [ ] **Step 6: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/api/demo/handlers/writes/fx-rates.ts \
  frontend/src/api/demo/handlers/reads/fx-rates.ts \
  frontend/src/api/demo/seed.ts \
  frontend/src/api/demo/handlers/reads/ \
  frontend/src/lib/fx.ts \
  frontend/src/lib/__tests__/fx.test.ts \
  frontend/src/api/demo/__tests__/
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(fx): demo-mode CRUD + reads parity"
```

---

## Task 8: Frontend Settings UI — FxSection

**Files:**
- Create: `frontend/src/pages/Settings/FxSection/index.tsx`
- Create: `frontend/src/pages/Settings/FxSection/DisplayCurrencyPicker.tsx`
- Create: `frontend/src/pages/Settings/FxSection/RatesTable.tsx`
- Create: `frontend/src/pages/Settings/FxSection/AddRateForm.tsx`
- Create: `frontend/src/pages/Settings/FxSection/SuggestionsStrip.tsx`
- Test: `frontend/src/pages/Settings/FxSection/__tests__/RatesTable.test.tsx`
- Test: `frontend/src/pages/Settings/FxSection/__tests__/AddRateForm.test.tsx`
- Modify: `frontend/src/pages/Settings.tsx` — mount `<FxSection />` below existing preference blocks.
- Modify: `frontend/src/locales/fr.json` and `frontend/src/locales/en.json` — add `settings.fx.*` keys.

**Interfaces:**
- Consumes: `/api/fx-rates` CRUD from Task 3, `/api/settings` PATCH for `displayCurrency`, `/api/accounts` to derive the currency union for smart suggestions.
- Produces: no downstream consumers.

- [ ] **Step 1: Draft the FR + EN locale keys**

Add to `frontend/src/locales/fr.json`:

```json
"settings.fx.title": "Multi-devises",
"settings.fx.description": "Consolidez plusieurs devises dans une devise d'affichage unique. Les taux sont saisis manuellement.",
"settings.fx.displayCurrency.label": "Devise d'affichage",
"settings.fx.displayCurrency.none": "Aucune (par devise)",
"settings.fx.rates.title": "Taux de change",
"settings.fx.rates.columns.from": "De",
"settings.fx.rates.columns.to": "Vers",
"settings.fx.rates.columns.effectiveFrom": "Effectif à partir du",
"settings.fx.rates.columns.rate": "Taux",
"settings.fx.rates.add": "Ajouter",
"settings.fx.rates.edit": "Modifier",
"settings.fx.rates.delete": "Supprimer",
"settings.fx.rates.duplicate": "Un taux existe déjà pour cette paire à cette date.",
"settings.fx.rates.invalidRate": "Taux invalide.",
"settings.fx.rates.sameCurrency": "La devise source et cible doivent être différentes.",
"settings.fx.suggest.missingPair": "{{from}} détecté sur un compte — aucun taux vers {{to}}."
```

Mirror keys in `en.json` with English copy. Skip the description for now if you're unsure of exact phrasing — but do fill every key with a plausible translation; no placeholders.

- [ ] **Step 2: Write the failing AddRateForm test**

Create `frontend/src/pages/Settings/FxSection/__tests__/AddRateForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddRateForm } from '../AddRateForm';

describe('AddRateForm', () => {
  it('accepts French decimal comma in the rate input', async () => {
    const onSubmit = vi.fn();
    render(<AddRateForm currencies={['EUR', 'USD']} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/^de$/i), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText(/^vers$/i), { target: { value: 'EUR' } });
    fireEvent.change(screen.getByLabelText(/effectif/i), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText(/taux/i), { target: { value: '0,9' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9',
    });
  });

  it('renders the rate input as type="text" (not "number") to accept French decimals', () => {
    const onSubmit = vi.fn();
    render(<AddRateForm currencies={['EUR', 'USD']} onSubmit={onSubmit} />);
    expect(screen.getByLabelText(/taux/i)).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(/taux/i)).toHaveAttribute('inputMode', 'decimal');
  });

  it('surfaces a duplicate error passed as a prop', () => {
    const onSubmit = vi.fn();
    render(<AddRateForm currencies={['EUR', 'USD']} onSubmit={onSubmit} error="duplicate" />);
    expect(screen.getByText(/existe déjà/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Implement AddRateForm**

Create `frontend/src/pages/Settings/FxSection/AddRateForm.tsx`. Keep the file under 300 lines. Use `parseDecimal` from `frontend/src/lib/format.ts`. Render `<input type="text" inputMode="decimal">` for the rate. Wire i18n via `useTranslation`. Emit `onSubmit({from, to, effectiveFrom, rate})` where `rate` is the string from `parseDecimal`.

- [ ] **Step 4: Run the AddRateForm test to verify pass**

Run: `cd frontend && npx vitest run src/pages/Settings/FxSection/__tests__/AddRateForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing RatesTable test**

Create `frontend/src/pages/Settings/FxSection/__tests__/RatesTable.test.tsx`:

```tsx
// Renders a fake rate list, asserts sort order (from, to, effective_from DESC).
// Simulates delete click → onDelete called with id.
// Simulates edit → inline input appears; save calls onEdit with { id, rate, effectiveFrom }.
```

Fill in with concrete cases (no ellipses in the final file — this is a plan-level sketch; the test writer's job is to expand it).

- [ ] **Step 6: Implement RatesTable**

Create `frontend/src/pages/Settings/FxSection/RatesTable.tsx`. Under 300 lines. Sort as above. Edit-in-place uses the same `parseDecimal` guard.

- [ ] **Step 7: Implement DisplayCurrencyPicker and SuggestionsStrip**

Both are small. DisplayCurrencyPicker is a `<select>` whose options are the union `{ EUR, USD, GBP } ∪ { currencies present in accounts }` plus a "None" option; onChange writes `PATCH /api/settings { displayCurrency }`. SuggestionsStrip diffs `accounts.currencies` against `rates` and lists missing pairs to the display currency.

- [ ] **Step 8: Implement the index composition**

Create `frontend/src/pages/Settings/FxSection/index.tsx`. React Query hooks: `useFxRates()` (GET), `useCreateFxRate()`, `useUpdateFxRate()`, `useDeleteFxRate()`, `useSetDisplayCurrency()`. Wire them into the components. Invalidate `["fx-rates"]` and `["settings"]` on mutation success.

- [ ] **Step 9: Mount FxSection on Settings page**

Modify `frontend/src/pages/Settings.tsx`: import `FxSection` and place it below the existing preference blocks.

- [ ] **Step 10: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Settings/FxSection/ \
  frontend/src/pages/Settings.tsx \
  frontend/src/locales/fr.json \
  frontend/src/locales/en.json
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(fx): settings — display currency + rates table UI"
```

---

## Task 9: Dashboard — consolidated total card + warning strip

**Files:**
- Create: `frontend/src/pages/Dashboard/ConsolidatedTotalCard.tsx`
- Test: `frontend/src/pages/Dashboard/__tests__/ConsolidatedTotalCard.test.tsx`
- Modify: `frontend/src/pages/Dashboard/index.tsx` — swap the per-currency card list for `ConsolidatedTotalCard` when `consolidated` is present; render warning strip.
- Modify: existing `frontend/src/pages/__tests__/Dashboard.test.tsx` — add `consolidated` fixtures.

**Interfaces:**
- Consumes: balance query response with the new `consolidated` shape from Task 4.
- Produces: no downstream consumers.

- [ ] **Step 1: Write the failing ConsolidatedTotalCard test**

```tsx
// Renders <ConsolidatedTotalCard consolidated={...} /> with:
//   - a clean consolidated (unmapped: []) — expects one big total, no warning strip.
//   - a partial consolidated (unmapped: [{currency:'USD',...}]) — expects warning strip
//     listing USD, and the total reflecting only mapped rows.
//   - null consolidated — expects the component to render nothing (or a placeholder).
```

Include copy assertions using i18n keys added below.

- [ ] **Step 2: Implement ConsolidatedTotalCard**

Under 200 lines. Displays `formatAmount(consolidated.total, consolidated.display)` prominently. Renders a "Convertie depuis N devises · Ajuster" chip that links to `/settings#fx`. Renders a warning strip listing each `unmapped[i].currency` with an inline "Add rate" link (deep-link to the settings section with the pair prefilled — for simplicity, just link to `/settings#fx`).

Add i18n keys used above to both locale files: `common.fx.convertedFrom`, `common.fx.unmappedWarning`, `common.fx.addRate`.

- [ ] **Step 3: Modify Dashboard/index.tsx**

Where `perCurrency` cards render today: if `balanceQ.data?.consolidated` is present, render `<ConsolidatedTotalCard consolidated={...} />` *plus* one small `perCurrency` card per row in `consolidated.unmapped` (raw fallback for unmapped currencies). Otherwise render the current per-currency card layout unchanged.

- [ ] **Step 4: Extend Dashboard.test.tsx**

Add fixtures where `perCurrency` includes EUR + USD and the query response includes `consolidated: { display: 'EUR', total: '190.00', ..., unmapped: [] }`. Assert only one big card renders.

Add a case where `consolidated.unmapped = [{ currency: 'GBP', total: '50.00', ... }]` and assert the warning strip renders.

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/pages/Dashboard/ConsolidatedTotalCard.tsx \
  frontend/src/pages/Dashboard/__tests__/ \
  frontend/src/pages/Dashboard/index.tsx \
  frontend/src/pages/__tests__/Dashboard.test.tsx \
  frontend/src/locales/fr.json \
  frontend/src/locales/en.json
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(fx): dashboard — consolidated total card"
```

---

## Task 10: BalanceChart consolidated line + budget page consumer

**Files:**
- Modify: `frontend/src/components/BalanceChart/index.tsx` — read `consolidated.points` when present, render single line; expose toggle for raw view.
- Modify: `frontend/src/components/BalanceChart/series.ts` — accept a `consolidated` branch or add a new helper for the consolidated series shape.
- Modify: `frontend/src/components/BalanceChart/__tests__/index.test.tsx` — add consolidated test cases.
- Modify: whichever budget page consumes `useBudgets` or the budget report — read `consolidated`.

**Interfaces:**
- Consumes: timeseries query response with new `consolidated` shape from Task 5; budget response from Task 6.
- Produces: no downstream consumers.

- [ ] **Step 1: Update timeseries data flow**

In the query hook that fetches `/api/reports/timeseries` (Dashboard reads it directly today), add `?display=...` from `settings.displayCurrency` (available via a settings hook — locate one; if none exists, use a small local hook that reads from the `/api/settings` query).

- [ ] **Step 2: Extend BalanceChart to render consolidated series**

Add a code path: when `consolidated` is present in the query response, build a single line from `consolidated.points` (X = `bucket`, Y = `Number(total)`) in the display currency. Otherwise render the current multi-line per-account per-currency view. Add a small toggle button/label ("Show raw per-currency") to switch back.

Mark buckets whose `unmapped` is non-empty (dashed segment). Simplest first pass: skip visual dashing, just add a tooltip note; refine later if needed.

- [ ] **Step 3: Extend tests**

Add cases where the timeseries response has `consolidated: { display: 'EUR', points: [...] }` and assert one series is drawn, and where `consolidated: null` and the current multi-line behavior stands.

- [ ] **Step 4: Wire the budget page consumer**

Locate the budget page (search `frontend/src/pages/Budget*` or `pages/Envelopes` — whichever consumes the budget report). If the page renders per-currency numbers, add a branch reading `consolidated` when present. If the budget report response shape is simple enough that `consolidated` is trivially rendered as one line item, add it and skip the toggle.

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com add \
  frontend/src/components/BalanceChart/ \
  frontend/src/pages/Dashboard/ \
  # + whichever budget page files were modified
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(fx): timeseries chart + budget page — consolidated consumers"
```

---

## Post-implementation verification

Not a task, but before the feature is considered done:

- [ ] `cd backend && npx vitest run` passes locally.
- [ ] `cd frontend && npx vitest run` passes locally.
- [ ] Manual smoke in dev: seed a USD account, add a USD→EUR rate at some past date, verify Dashboard collapses to a single EUR total.
- [ ] Delete the USD→EUR rate, verify the warning strip appears listing USD, and the raw USD card reappears.
- [ ] Set `displayCurrency = null` via Settings, verify the app reverts to the current per-currency card layout.

## Self-review notes (author, not for the executor)

- Every spec requirement (D1–D7) has at least one task. D7's hybrid split was refined to uniform TS-side in this plan — see the header. If a future iteration wants SQL for perf, the shared aggregator is easy to move.
- All new frontend files sit comfortably under 300 lines when split as prescribed. If any component grows past that during implementation, split it further before committing.
- No placeholders in code blocks — every step has runnable content. The one exception is Task 6 Step 1 (enumerate budget response's numeric fields) which requires reading the actual file. That's intentional: the budget response shape is complex enough that hard-coding it here would be a lie.
- Task 8 Step 5 sketches the RatesTable test rather than transcribing it fully. Reasoning: transcribing the sort-order + edit-in-place assertions verbatim would double the file length without adding executor guidance — the sketch is enough for a competent implementer.
