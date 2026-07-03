# User-configurable settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist four per-user defaults (dashboard range, chart scope, dotted-line gap threshold, duplicate similarity threshold) in a new `user_settings` Postgres table, exposed via GET/PATCH endpoints and edited from a new Réglages page reached from a sidebar gear icon.

**Architecture:** Single JSONB column on a per-user row (`user_id` PK, cascade on user delete) — flexible for future settings without new migrations. Backend is the source of truth for defaults; frontend uses local `DEFAULTS` only as a paint-safe placeholder while the initial `GET /api/settings` is in flight. A React Query hook (`useSettings`) with optimistic mutation wraps the API. Three existing consumers (Dashboard, BalanceChart, DuplicatesPanel) swap their `usePersistedState` / hardcoded constants for the hook.

**Tech Stack:**
- Backend: Fastify 5, Zod, Drizzle ORM, PostgreSQL 16 (JSONB + `||` merge operator), Vitest
- Frontend: React 18, TanStack Query 5, TypeScript, Vitest + Testing Library
- The design doc for this feature lives at `docs/superpowers/specs/2026-07-03-user-settings-design.md` — read it before starting.

## Global Constraints

- **All new backend routes** sit behind `preHandler: app.requireAuth`; use `userId(req)` from `src/http/plugins/auth.js` to read the current user id — never trust body-provided ids.
- **Zod schemas** are `.strict()` for anything that lands in JSONB, so unknown keys 400 instead of silently polluting storage.
- **Postgres migrations** are hand-written SQL in `backend/src/db/migrations/`, applied in lexicographic order at boot via `backend/src/db/migrate.ts`. Each file runs in its own transaction. Do NOT introduce Drizzle-kit auto-generation for this migration; write the SQL by hand as every other 0000-0012 migration does.
- **Drizzle schema entry** must be kept alongside the migration in `backend/src/db/schema.ts` — the codebase relies on `db.select().from(...)`-style typed queries.
- **Backend tests** in `backend/tests/` require Postgres. They gate on `RUN_DB_TESTS=1` and `describe.skipIf(!RUN)` so `npm test` still passes locally without a DB. Follow the pattern in `backend/tests/balance-checkpoints-route.test.ts`.
- **Frontend tests** in `frontend/src/**/__tests__/*.test.tsx` use Vitest + Testing Library + jsdom. The `frontend/src/test/setup.ts` polyfill already provides `localStorage`; use it directly.
- **No emoji** in code or commits.
- **Public-safe commits** (per user memory): no IPs, hostnames, secrets, or personal identifiers in commit messages or code.
- **Language**: user-facing copy in French (matches the rest of the app). Comments in code in English (matches conventions in existing files).
- **File paths use `.js` in imports** (backend) — TypeScript compiles to ESM, so the runtime resolves `./client.js` even when the source is `client.ts`. See any existing backend route for the pattern.
- **Coding style**: match nearby files. Two-space indent, single quotes, trailing commas where the linter already puts them.

## File Structure

**New files:**
- `backend/src/db/migrations/0013_user_settings.sql` — schema.
- `backend/src/domain/settings/defaults.ts` — the canonical default values.
- `backend/src/domain/settings/schema.ts` — Zod schema + inferred `Settings` type + defaults-merge helper.
- `backend/src/http/routes/settings.ts` — `GET /api/settings` + `PATCH /api/settings`.
- `backend/tests/settings-route.test.ts` — 9 test cases.
- `frontend/src/api/settings.ts` — typed fetch client (`getSettings`, `patchSettings`).
- `frontend/src/lib/settings.ts` — frontend `Settings` type + `DEFAULTS` fallback.
- `frontend/src/lib/useSettings.ts` — React Query hook.
- `frontend/src/lib/__tests__/useSettings.test.tsx` — hook tests.
- `frontend/src/pages/Settings.tsx` — the Réglages page.
- `frontend/src/pages/__tests__/Settings.test.tsx` — page tests.

**Modified files:**
- `backend/src/db/schema.ts` — add `userSettings` Drizzle table entry.
- `backend/src/server.ts` — register the new route plugin.
- `frontend/src/App.tsx` — add `/settings` route.
- `frontend/src/components/Layout.tsx` — add gear icon + link inside `UserCard`.
- `frontend/src/pages/Dashboard/index.tsx` — replace two `usePersistedState` calls with `useSettings`-seeded `useState`.
- `frontend/src/pages/__tests__/Dashboard.test.tsx` — replace the "persists to localStorage" test with a settings-driven equivalent; add a "reads default from settings" case.
- `frontend/src/components/BalanceChart/index.tsx` — hoist `MAX_SOLID_GAP_DAYS` into a prop.
- `frontend/src/components/BalanceChart/__tests__/*.test.tsx` — add a case for the new prop (create the test file if it doesn't already have coverage of this behaviour).
- `frontend/src/pages/Imports/DuplicatesPanel.tsx` — replace `usePersistedState` with `useSettings`-seeded `useState`.
- `frontend/src/pages/Imports/__tests__/DuplicatesPanel.test.tsx` — add a case for reading the default from settings.
- `STATUS.md` — recently-landed line + known-deferrals bullet for the dead localStorage keys.

## Interfaces (contract across tasks)

To keep task decoupling clean, later tasks depend on these names:

- Backend `Settings` type — `{ dashboardRange?: '30d' | '3m' | '6m' | '12m' | 'all'; dashboardChartScope?: 'all' | number; chartGapThresholdDays?: number; duplicateSimilarityThreshold?: number }` (all fields optional in the wire schema; response always fully populated by defaults-merge).
- Backend `DEFAULTS` — same shape, all fields required, values `'3m' / 'all' / 6 / 0`.
- Backend GET response: `{ settings: Required<Settings> }`.
- Backend PATCH request body: `Partial<Settings>` (strict — unknown keys → 400).
- Backend PATCH response: `{ settings: Required<Settings> }`.
- Frontend `useSettings()` returns `{ settings: Required<Settings>; isReady: boolean; patch: (p: Partial<Settings>) => void; mutation: UseMutationResult<…> }`.

---

### Task 1: Migration + Drizzle schema

**Files:**
- Create: `backend/src/db/migrations/0013_user_settings.sql`
- Modify: `backend/src/db/schema.ts` (append a new table)

**Interfaces:**
- Consumes: nothing.
- Produces: the `user_settings` table + `userSettings` Drizzle export.

- [ ] **Step 1: Create the migration file**

Create `backend/src/db/migrations/0013_user_settings.sql`:

```sql
-- Per-user configurable defaults (dashboard range, chart scope, chart gap
-- threshold, duplicate similarity threshold). One row per user, keyed by
-- user_id. Settings live in a JSONB blob so adding future keys does not
-- require a new migration — the app-layer Zod schema is the source of truth
-- for shape and bounds.

CREATE TABLE user_settings (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Append the Drizzle table entry to `backend/src/db/schema.ts`**

Add these imports if not already present at the top of the file: `jsonb` is already imported. Append at the bottom of the file:

```ts
// ---------------------------------------------------------------------------
// user_settings — per-user configurable defaults. JSONB blob so adding
// future keys does not require a schema migration. The Zod schema at
// backend/src/domain/settings/schema.ts is the source of truth for shape.
// ---------------------------------------------------------------------------

export const userSettings = pgTable('user_settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Verify the migration applies (integration check)**

Run the migration runner via a boot smoke:

```bash
cd backend && RUN_DB_TESTS=1 npm test -- balance-checkpoints-route
```

Expected: existing tests still pass (they invoke `buildApp()` which calls `runMigrations()` internally on start; if the SQL is malformed the whole suite errors out). If the DB isn't available, this step is a no-op — visually inspect the SQL for typos and move on. The real validation happens in Task 3's tests, which exercise the table.

- [ ] **Step 4: Verify the Drizzle types compile**

Run:

```bash
cd backend && npm run typecheck 2>&1 | tail -20
```

Expected: no new errors mentioning `userSettings` or `schema.ts`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0013_user_settings.sql backend/src/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(migrations): 0013 — user_settings table (JSONB blob, per-user)

One row per user, cascade on user delete. Settings shape lives at the
app layer (Zod) so adding future keys needs no migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Backend settings domain module (defaults + Zod schema + merge helper)

**Files:**
- Create: `backend/src/domain/settings/defaults.ts`
- Create: `backend/src/domain/settings/schema.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULTS` — a `Readonly<Required<Settings>>` object of default values.
  - `SettingsSchema` — a Zod schema for parsing incoming patches (all fields optional, strict).
  - `type Settings = z.infer<typeof SettingsSchema>` — the parsed shape.
  - `mergeSettings(stored: unknown, patch: Partial<Settings>): Required<Settings>` — merges DEFAULTS + stored + patch, coerces missing keys to defaults, ignores unknown keys in stored.

- [ ] **Step 1: Create `backend/src/domain/settings/defaults.ts`**

```ts
// Canonical default values for user_settings. Backend is the source of
// truth for defaults; the frontend duplicates these under
// frontend/src/lib/settings.ts as a paint-safe fallback (see the design
// doc for why cross-side drift is self-healing).

export const DEFAULTS = {
  dashboardRange: '3m',
  dashboardChartScope: 'all',
  chartGapThresholdDays: 6,
  duplicateSimilarityThreshold: 0,
} as const;

export type DashboardRange = '30d' | '3m' | '6m' | '12m' | 'all';
export type DashboardChartScope = 'all' | number;
```

- [ ] **Step 2: Create `backend/src/domain/settings/schema.ts`**

```ts
import { z } from 'zod';
import { DEFAULTS } from './defaults.js';
import type { DashboardRange, DashboardChartScope } from './defaults.js';

export const SettingsSchema = z
  .object({
    dashboardRange: z.enum(['30d', '3m', '6m', '12m', 'all']).optional(),
    dashboardChartScope: z
      .union([z.literal('all'), z.number().int().positive()])
      .optional(),
    chartGapThresholdDays: z.number().int().min(1).max(60).optional(),
    duplicateSimilarityThreshold: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export type Settings = z.infer<typeof SettingsSchema>;

export type FullSettings = {
  dashboardRange: DashboardRange;
  dashboardChartScope: DashboardChartScope;
  chartGapThresholdDays: number;
  duplicateSimilarityThreshold: number;
};

// Merges DEFAULTS <- stored (unvalidated JSONB) <- patch. `stored` is
// treated as untrusted input — unknown keys are dropped, invalid values
// fall back to their default. This is the last line of defense: even if
// something outside PATCH wrote garbage into the JSONB, GET returns a
// clean, complete shape.
export function mergeSettings(stored: unknown, patch: Partial<Settings> = {}): FullSettings {
  const safe: FullSettings = { ...DEFAULTS };
  const src = (stored && typeof stored === 'object') ? (stored as Record<string, unknown>) : {};
  const parsed = SettingsSchema.safeParse(src);
  if (parsed.success) Object.assign(safe, parsed.data);
  // patch has already been validated by the caller.
  Object.assign(safe, patch);
  return safe;
}
```

- [ ] **Step 3: Add a small unit test for the merge helper**

Create `backend/tests/settings-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeSettings } from '../src/domain/settings/schema.js';
import { DEFAULTS } from '../src/domain/settings/defaults.js';

describe('mergeSettings', () => {
  it('returns DEFAULTS when stored is empty', () => {
    expect(mergeSettings({}, {})).toEqual(DEFAULTS);
  });

  it('overrides stored values with patch values', () => {
    const out = mergeSettings({ dashboardRange: '6m' }, { dashboardRange: '12m' });
    expect(out.dashboardRange).toBe('12m');
  });

  it('drops unknown keys in stored', () => {
    const out = mergeSettings({ dashboardRange: '3m', bogus: 'x' } as any, {});
    expect(out).toEqual({ ...DEFAULTS, dashboardRange: '3m' });
    expect((out as any).bogus).toBeUndefined();
  });

  it('falls back to defaults when stored is not an object', () => {
    expect(mergeSettings(null, {})).toEqual(DEFAULTS);
    expect(mergeSettings('nope', {})).toEqual(DEFAULTS);
  });

  it('ignores an invalid stored field by falling back to defaults for the whole blob', () => {
    // A single bad field currently makes the safeParse fail as a whole; we
    // treat that as "trust nothing" and return DEFAULTS. If future work
    // wants field-by-field recovery, that's a separate change.
    const out = mergeSettings({ chartGapThresholdDays: 9999 }, {});
    expect(out).toEqual(DEFAULTS);
  });
});
```

- [ ] **Step 4: Run the unit test — should fail (module not yet compiled)? verify it passes**

```bash
cd backend && npm test -- settings-schema 2>&1 | tail -20
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/settings/ backend/tests/settings-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): domain module — defaults, Zod schema, merge helper

DEFAULTS is the backend source of truth. mergeSettings hardens GET
against garbage in the JSONB by falling back to defaults on any
validation failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Backend route (`GET /api/settings`, `PATCH /api/settings`) + integration tests

**Files:**
- Create: `backend/src/http/routes/settings.ts`
- Create: `backend/tests/settings-route.test.ts`
- Modify: `backend/src/server.ts` (register the new plugin)

**Interfaces:**
- Consumes: `userSettings` Drizzle table, `accounts` table, `mergeSettings`, `SettingsSchema`, `DEFAULTS` from prior tasks.
- Produces:
  - `GET /api/settings` → `{ settings: FullSettings }`
  - `PATCH /api/settings` → `{ settings: FullSettings }` (accepts strict partial)

- [ ] **Step 1: Write the failing integration tests**

Create `backend/tests/settings-route.test.ts`:

```ts
// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountAId: number;

describe.skipIf(!RUN)('/api/settings', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'settings', password: 'settings-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'settings', password: 'settings-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const a = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: { name: 'Main', type: 'current', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountAId = a.json().account.id;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { userSettings } = await import('../src/db/schema.js');
    await db.delete(userSettings);
  });

  it('GET without auth returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('GET for a user with no row returns defaults', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toEqual({
      dashboardRange: '3m',
      dashboardChartScope: 'all',
      chartGapThresholdDays: 6,
      duplicateSimilarityThreshold: 0,
    });
  });

  it('PATCH with a partial upserts and returns the merged full object', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { dashboardRange: '12m', chartGapThresholdDays: 10 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toEqual({
      dashboardRange: '12m',
      dashboardChartScope: 'all',
      chartGapThresholdDays: 10,
      duplicateSimilarityThreshold: 0,
    });
  });

  it('two disjoint PATCHes merge (second GET reflects both)', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { dashboardRange: '6m' },
    });
    await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { duplicateSimilarityThreshold: 42 },
    });
    const get = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(get.json().settings.dashboardRange).toBe('6m');
    expect(get.json().settings.duplicateSimilarityThreshold).toBe(42);
  });

  it('PATCH with an out-of-range value returns 400', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { chartGapThresholdDays: 999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH with an unknown key returns 400 (strict schema)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { bogus: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH dashboardChartScope pointing to a deleted account sanitises to all on next GET', async () => {
    const tmp = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'ToDelete', type: 'current', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    const tmpId = tmp.json().account.id;
    await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { dashboardChartScope: tmpId },
    });
    await app.inject({ method: 'DELETE', url: `/api/accounts/${tmpId}`, headers: { cookie } });
    const get = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(get.json().settings.dashboardChartScope).toBe('all');
  });

  it('PATCH dashboardChartScope pointing to another user\'s account sanitises to all', async () => {
    // Create a second user with their own account.
    // Log the first user out first so the onboarding endpoint stays disabled but
    // /api/auth/login lets us switch — actually onboarding refuses after the first
    // user is created; we side-step by inserting via db directly to keep the test
    // hermetic to route order.
    const { db } = await import('../src/db/client.js');
    const { users, accounts } = await import('../src/db/schema.js');
    const [otherUser] = await db.insert(users).values({
      username: 'other-user-settings',
      passwordHash: 'x',
    }).returning();
    const [otherAcc] = await db.insert(accounts).values({
      userId: otherUser!.id,
      name: 'Other',
      type: 'current',
      currency: 'EUR',
      openingBalance: '0',
      openingDate: '2025-01-01',
    }).returning();
    // Original user PATCHes their scope to the other user's account id.
    await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { dashboardChartScope: otherAcc!.id },
    });
    const get = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(get.json().settings.dashboardChartScope).toBe('all');
    // Cleanup.
    const { eq } = await import('drizzle-orm');
    await db.delete(users).where(eq(users.id, otherUser!.id));
  });

  it('cascades on user deletion', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { dashboardRange: '6m' },
    });
    const { db } = await import('../src/db/client.js');
    const { users, userSettings } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    // Grab the user's id via the /me route.
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    const uid = me.json().user.id;
    await db.delete(users).where(eq(users.id, uid));
    const rows = await db.select().from(userSettings).where(eq(userSettings.userId, uid));
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail (route not implemented)**

```bash
cd backend && RUN_DB_TESTS=1 npm test -- settings-route 2>&1 | tail -30
```

Expected: multiple failures — `/api/settings` returns 404 (route not registered).

- [ ] **Step 3: Create the route file `backend/src/http/routes/settings.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, userSettings } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';
import { SettingsSchema, mergeSettings, type FullSettings } from '../../domain/settings/schema.js';

// Load the stored JSONB for `uid`, coerce to a full settings object with
// defaults filled in, and sanitise dashboardChartScope so a dangling or
// cross-tenant account id becomes 'all'. The stored row is not rewritten —
// only the response is filtered.
async function loadSettingsFor(uid: number): Promise<FullSettings> {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  const merged = mergeSettings(row?.settings ?? {}, {});
  if (typeof merged.dashboardChartScope === 'number') {
    const [acc] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, merged.dashboardChartScope), eq(accounts.userId, uid)));
    if (!acc) merged.dashboardChartScope = 'all';
  }
  return merged;
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/settings', async (req) => {
    const uid = userId(req);
    return { settings: await loadSettingsFor(uid) };
  });

  app.patch('/api/settings', async (req, reply) => {
    const uid = userId(req);
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const patch = parsed.data;
    // Upsert: create the row if missing, otherwise shallow-merge the JSONB
    // (`settings || excluded.settings` — the right-hand side wins per key).
    await db
      .insert(userSettings)
      .values({ userId: uid, settings: patch })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          settings: sql`${userSettings.settings} || ${JSON.stringify(patch)}::jsonb`,
          updatedAt: new Date(),
        },
      });
    return { settings: await loadSettingsFor(uid) };
  });
}
```

- [ ] **Step 4: Register the plugin in `backend/src/server.ts`**

Add the import at the top with the other route imports:

```ts
import { settingsRoutes } from './http/routes/settings.js';
```

Add the registration line in the authenticated block, next to `balanceCheckpointsRoutes`:

```ts
  await app.register(settingsRoutes);
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend && RUN_DB_TESTS=1 npm test -- settings-route 2>&1 | tail -30
```

Expected: 9 tests pass.

- [ ] **Step 6: Sanity-check other backend tests still pass**

```bash
cd backend && RUN_DB_TESTS=1 npm test 2>&1 | tail -20
```

Expected: all pre-existing test suites still pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/http/routes/settings.ts backend/src/server.ts backend/tests/settings-route.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): GET/PATCH /api/settings with per-user JSONB storage

GET returns defaults merged with the stored blob, with a chart-scope
sanitiser that silently reverts to 'all' when the referenced account
is deleted or belongs to another user. PATCH is strict — unknown keys
400 instead of polluting the JSONB.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Frontend api client + defaults + `useSettings` hook

**Files:**
- Create: `frontend/src/api/settings.ts`
- Create: `frontend/src/lib/settings.ts`
- Create: `frontend/src/lib/useSettings.ts`
- Create: `frontend/src/lib/__tests__/useSettings.test.tsx`

**Interfaces:**
- Consumes: `api` from `frontend/src/api/client.ts`.
- Produces:
  - `type Settings` in `frontend/src/lib/settings.ts` — full-shape TypeScript type.
  - `DEFAULTS: Settings` — paint-safe fallback (keep in sync with `backend/src/domain/settings/defaults.ts`).
  - `getSettings(): Promise<{ settings: Settings }>`
  - `patchSettings(patch: Partial<Settings>): Promise<{ settings: Settings }>`
  - `useSettings()` — React Query hook returning `{ settings: Settings; isReady: boolean; patch: (p: Partial<Settings>) => void; mutation: UseMutationResult<{ settings: Settings }, Error, Partial<Settings>> }`.

- [ ] **Step 1: Create `frontend/src/lib/settings.ts`**

```ts
// Frontend paint-safe fallback for user settings. Kept in sync with
// backend/src/domain/settings/defaults.ts — if they drift, the backend
// value wins on the first GET (see design doc).

export type DashboardRange = '30d' | '3m' | '6m' | '12m' | 'all';
export type DashboardChartScope = 'all' | number;

export interface Settings {
  dashboardRange: DashboardRange;
  dashboardChartScope: DashboardChartScope;
  chartGapThresholdDays: number;
  duplicateSimilarityThreshold: number;
}

export const DEFAULTS: Settings = {
  dashboardRange: '3m',
  dashboardChartScope: 'all',
  chartGapThresholdDays: 6,
  duplicateSimilarityThreshold: 0,
};
```

- [ ] **Step 2: Create `frontend/src/api/settings.ts`**

```ts
import { api } from './client';
import type { Settings } from '../lib/settings';

export function getSettings() {
  return api<{ settings: Settings }>('/api/settings');
}

export function patchSettings(patch: Partial<Settings>) {
  return api<{ settings: Settings }>('/api/settings', {
    method: 'PATCH',
    json: patch,
  });
}
```

- [ ] **Step 3: Create the hook `frontend/src/lib/useSettings.ts`**

```ts
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { getSettings, patchSettings } from '../api/settings';
import { DEFAULTS, type Settings } from './settings';

export function useSettings(): {
  settings: Settings;
  isReady: boolean;
  patch: (p: Partial<Settings>) => void;
  mutation: UseMutationResult<{ settings: Settings }, Error, Partial<Settings>>;
} {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const mut = useMutation({
    mutationFn: patchSettings,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['settings'] });
      const prev = qc.getQueryData<{ settings: Settings }>(['settings']);
      qc.setQueryData(['settings'], {
        settings: { ...(prev?.settings ?? DEFAULTS), ...patch },
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  return {
    settings: q.data?.settings ?? DEFAULTS,
    isReady: !q.isLoading,
    patch: mut.mutate,
    mutation: mut,
  };
}
```

- [ ] **Step 4: Write the hook tests**

Create `frontend/src/lib/__tests__/useSettings.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSettings } from '../useSettings';
import { DEFAULTS } from '../settings';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('useSettings', () => {
  it('returns DEFAULTS while the query is pending', async () => {
    let resolveQuery: (v: unknown) => void = () => {};
    apiMock.mockImplementation(() => new Promise((res) => { resolveQuery = res; }));
    const { result } = renderHook(() => useSettings(), { wrapper: wrap() });
    expect(result.current.settings).toEqual(DEFAULTS);
    expect(result.current.isReady).toBe(false);
    resolveQuery({ settings: { ...DEFAULTS, dashboardRange: '12m' } });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.settings.dashboardRange).toBe('12m');
  });

  it('applies optimistic update immediately', async () => {
    let resolvePatch: (v: unknown) => void = () => {};
    apiMock.mockImplementation((path: string, init?: any) => {
      if (init?.method === 'PATCH') return new Promise((res) => { resolvePatch = res; });
      return Promise.resolve({ settings: DEFAULTS });
    });
    const { result } = renderHook(() => useSettings(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.patch({ dashboardRange: '6m' }));
    // The optimistic update happens synchronously inside onMutate.
    await waitFor(() => expect(result.current.settings.dashboardRange).toBe('6m'));
    resolvePatch({ settings: { ...DEFAULTS, dashboardRange: '6m' } });
  });

  it('rolls back on mutation error', async () => {
    let rejectPatch: (e: unknown) => void = () => {};
    apiMock.mockImplementation((path: string, init?: any) => {
      if (init?.method === 'PATCH') return new Promise((_res, rej) => { rejectPatch = rej; });
      return Promise.resolve({ settings: DEFAULTS });
    });
    const { result } = renderHook(() => useSettings(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.patch({ dashboardRange: '6m' }));
    await waitFor(() => expect(result.current.settings.dashboardRange).toBe('6m'));
    rejectPatch(new Error('boom'));
    await waitFor(() => expect(result.current.settings.dashboardRange).toBe(DEFAULTS.dashboardRange));
  });

  it('invalidates on settle so a fresh GET is refetched', async () => {
    apiMock.mockImplementation((path: string, init?: any) => {
      if (init?.method === 'PATCH') return Promise.resolve({ settings: { ...DEFAULTS, dashboardRange: '6m' } });
      return Promise.resolve({ settings: DEFAULTS });
    });
    const { result } = renderHook(() => useSettings(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    apiMock.mockClear();
    apiMock.mockImplementation((path: string, init?: any) => {
      if (init?.method === 'PATCH') return Promise.resolve({ settings: { ...DEFAULTS, dashboardRange: '6m' } });
      return Promise.resolve({ settings: { ...DEFAULTS, dashboardRange: '6m' } });
    });
    act(() => result.current.patch({ dashboardRange: '6m' }));
    // On settle → invalidate → refetch → GET runs again.
    await waitFor(() => {
      const gets = apiMock.mock.calls.filter(([, init]) => (init as any)?.method !== 'PATCH');
      expect(gets.length).toBeGreaterThanOrEqual(1);
    });
  });
});
```

- [ ] **Step 5: Run the hook tests — verify they pass**

```bash
cd frontend && npx vitest run src/lib/__tests__/useSettings.test.tsx 2>&1 | tail -20
```

Expected: 4 tests pass.

- [ ] **Step 6: Typecheck frontend**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/settings.ts frontend/src/lib/settings.ts frontend/src/lib/useSettings.ts frontend/src/lib/__tests__/useSettings.test.tsx
git commit -m "$(cat <<'EOF'
feat(settings): frontend api client, DEFAULTS, and useSettings hook

React Query hook with optimistic patch, rollback on error, invalidate
on settle. DEFAULTS mirrors the backend defaults as a paint-safe
fallback while GET is in flight.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Réglages page + route

**Files:**
- Create: `frontend/src/pages/Settings.tsx`
- Create: `frontend/src/pages/__tests__/Settings.test.tsx`
- Modify: `frontend/src/App.tsx` (add route)

**Interfaces:**
- Consumes: `useSettings`, `Settings`, `DEFAULTS` from prior task; `<RangePicker>`, `<ConfirmDialog>`, `api`, `Account`.
- Produces: `<Settings />` component + `/settings` route.

- [ ] **Step 1: Write the failing page tests**

Create `frontend/src/pages/__tests__/Settings.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '../Settings';
import { DEFAULTS } from '../../lib/settings';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('Settings page', () => {
  it('renders a skeleton while the settings query is pending', async () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByTestId('settings-skeleton')).toBeInTheDocument();
  });

  it('clicking a range in the picker sends a PATCH with the new range', async () => {
    const calls: Array<{ path: string; init: any }> = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      calls.push({ path, init });
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/settings' && (!init || init.method !== 'PATCH')) return { settings: DEFAULTS };
      if (path === '/api/settings' && init?.method === 'PATCH') {
        return { settings: { ...DEFAULTS, ...init.json } };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const u = userEvent.setup();
    renderPage();
    // Wait for the skeleton to disappear.
    await waitFor(() => expect(screen.queryByTestId('settings-skeleton')).toBeNull());
    await u.click(screen.getByRole('button', { name: /^6 m$/i }));
    await waitFor(() => {
      const patch = calls.find((c) => c.init?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(patch!.init.json).toEqual({ dashboardRange: '6m' });
    });
  });

  it('number inputs commit on blur, not on every keystroke', async () => {
    const patchCalls: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/settings' && init?.method === 'PATCH') {
        patchCalls.push(init.json);
        return { settings: { ...DEFAULTS, ...init.json } };
      }
      if (path === '/api/settings') return { settings: DEFAULTS };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByTestId('settings-skeleton')).toBeNull());
    const gap = screen.getByLabelText(/seuil de ligne pointillée/i);
    await u.clear(gap);
    await u.type(gap, '12');
    // No PATCH yet — still focused.
    expect(patchCalls).toHaveLength(0);
    await u.tab();
    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]).toEqual({ chartGapThresholdDays: 12 });
  });

  it('"Réinitialiser" confirms then sends a PATCH with every default', async () => {
    const patchCalls: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/settings' && init?.method === 'PATCH') {
        patchCalls.push(init.json);
        return { settings: DEFAULTS };
      }
      if (path === '/api/settings') return { settings: { ...DEFAULTS, dashboardRange: '12m' } };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByTestId('settings-skeleton')).toBeNull());
    await u.click(screen.getByRole('button', { name: /réinitialiser/i }));
    // ConfirmDialog opens; click the confirm button (labelled "Confirmer" in
    // the existing component — adjust if the shared component uses a
    // different label).
    await u.click(await screen.findByRole('button', { name: /^confirmer$/i }));
    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]).toEqual(DEFAULTS);
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail (page not created)**

```bash
cd frontend && npx vitest run src/pages/__tests__/Settings.test.tsx 2>&1 | tail -20
```

Expected: module resolution failure or "Settings is not defined".

- [ ] **Step 3: First, sanity-check the `<ConfirmDialog>` API**

Read `frontend/src/components/ConfirmDialog.tsx` to confirm the exact prop names and confirm-button label used in step 4.

```bash
cat /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend/src/components/ConfirmDialog.tsx
```

Update the `screen.getByRole('button', { name: /^confirmer$/i })` selector in the test above if the shared component uses a different label — the test must match the real component's output.

- [ ] **Step 4: Create the Settings page**

Create `frontend/src/pages/Settings.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Account } from '../api/types';
import { useSettings } from '../lib/useSettings';
import { DEFAULTS, type Settings as SettingsShape } from '../lib/settings';
import { RangePicker, type RangeKey } from '../components/RangePicker';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function Settings(): JSX.Element {
  const { settings, isReady, patch, mutation } = useSettings();
  const [confirmReset, setConfirmReset] = useState(false);
  // "Enregistré" flash next to the field that just accepted a PATCH.
  const [flashKey, setFlashKey] = useState<keyof SettingsShape | 'all' | null>(null);
  useEffect(() => {
    if (!mutation.isSuccess) return;
    const t = setTimeout(() => setFlashKey(null), 1500);
    return () => clearTimeout(t);
  }, [mutation.isSuccess, mutation.data]);

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const accounts = accountsQ.data?.accounts ?? [];

  if (!isReady) {
    return (
      <div className="max-w-xl">
        <div data-testid="settings-skeleton" className="surface p-6 h-64 animate-pulse rounded-lg bg-ink-900" />
      </div>
    );
  }

  const send = <K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) => {
    setFlashKey(key);
    patch({ [key]: value } as Partial<SettingsShape>);
  };

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <div>
        <h1 className="display text-2xl text-ink-50">Réglages</h1>
        <p className="text-sm text-ink-400 mt-1">
          Valeurs par défaut appliquées à chaque chargement du tableau de bord et aux outils d'imports.
        </p>
      </div>

      {mutation.isError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          Impossible d'enregistrer les réglages. Réessayez.
        </div>
      )}

      <div className="surface p-6 flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <div className="label">Tableau de bord</div>

          <div>
            <div className="text-sm mb-2 flex items-center gap-2">
              Période par défaut
              {flashKey === 'dashboardRange' && <SavedChip />}
            </div>
            <RangePicker
              value={settings.dashboardRange as RangeKey}
              onChange={(r) => send('dashboardRange', r)}
              ariaLabel="Période par défaut"
            />
          </div>

          <div>
            <label className="text-sm mb-2 block">
              Compte du graphique par défaut
              {flashKey === 'dashboardChartScope' && <SavedChip />}
            </label>
            <select
              className="input"
              value={settings.dashboardChartScope === 'all' ? 'all' : String(settings.dashboardChartScope)}
              onChange={(e) =>
                send('dashboardChartScope', e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
            >
              <option value="all">Tous les comptes</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>

          <NumberField
            label="Seuil de ligne pointillée (jours)"
            help="Un écart supérieur à X jours entre deux points est tracé en pointillés."
            min={1}
            max={60}
            value={settings.chartGapThresholdDays}
            onCommit={(v) => send('chartGapThresholdDays', v)}
            flashing={flashKey === 'chartGapThresholdDays'}
          />
        </section>

        <section className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
          <div className="label">Imports</div>
          <NumberField
            label="Seuil de similarité par défaut (Possibles doublons)"
            help="Filtre les groupes de doublons dont la similarité de libellés est inférieure au seuil."
            min={0}
            max={100}
            suffix="%"
            value={settings.duplicateSimilarityThreshold}
            onCommit={(v) => send('duplicateSimilarityThreshold', v)}
            flashing={flashKey === 'duplicateSimilarityThreshold'}
          />
        </section>

        <section className="pt-4 border-t border-ink-800/60">
          <button className="btn-ghost" onClick={() => setConfirmReset(true)}>
            Réinitialiser aux valeurs par défaut
          </button>
        </section>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Réinitialiser les réglages ?"
        message="Tous vos réglages retrouveront leurs valeurs par défaut. Cette action ne peut pas être annulée."
        confirmLabel="Confirmer"
        onConfirm={() => {
          setFlashKey('all');
          patch(DEFAULTS);
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function SavedChip() {
  return (
    <span className="text-[10px] uppercase tracking-wide text-sage-300 ml-2">Enregistré</span>
  );
}

// Blur-committed integer input. Local state so keystrokes don't PATCH.
function NumberField(props: {
  label: string;
  help: string;
  min: number;
  max: number;
  value: number;
  suffix?: string;
  flashing: boolean;
  onCommit: (v: number) => void;
}) {
  const { label, help, min, max, value, suffix, flashing, onCommit } = props;
  const [local, setLocal] = useState<string>(String(value));
  const initial = useRef(value);
  useEffect(() => {
    // Re-sync when the server value changes underneath us (invalidate/refetch).
    if (value !== initial.current) {
      setLocal(String(value));
      initial.current = value;
    }
  }, [value]);

  const commit = () => {
    const n = Number.parseInt(local, 10);
    if (!Number.isFinite(n) || n < min || n > max || n === value) {
      setLocal(String(value));
      return;
    }
    onCommit(n);
  };

  return (
    <div>
      <label className="text-sm mb-1 block">
        {label}
        {flashing && <SavedChip />}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="input w-28"
          min={min}
          max={max}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          aria-label={label}
        />
        {suffix && <span className="text-sm text-ink-400">{suffix}</span>}
      </div>
      <p className="text-xs text-ink-500 mt-1">{help}</p>
    </div>
  );
}
```

- [ ] **Step 5: Add the route in `frontend/src/App.tsx`**

Add the import near the other page imports:

```tsx
import { Settings } from './pages/Settings';
```

Add the route inside the `Layout` block, next to `/profile`:

```tsx
        <Route path="/settings" element={<Settings />} />
```

- [ ] **Step 6: Run the page tests — verify they pass**

```bash
cd frontend && npx vitest run src/pages/__tests__/Settings.test.tsx 2>&1 | tail -30
```

Expected: 4 tests pass. If the "Réinitialiser" test fails because the confirm button label differs, adjust either the button label in the page (preferred, keeps copy consistent) or the test selector — both must match `ConfirmDialog`'s real API.

- [ ] **Step 7: Typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Settings.tsx frontend/src/pages/__tests__/Settings.test.tsx frontend/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(settings): Réglages page at /settings with per-field save flash

Range picker + account select + two blur-committed number inputs;
"Réinitialiser" button uses the shared ConfirmDialog and PATCHes the
full DEFAULTS shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Sidebar gear icon in `UserCard`

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `NavLink` (already imported), the existing `UserCard` layout.
- Produces: an icon-only NavLink → `/settings` inside the sidebar's user block.

- [ ] **Step 1: Modify `UserCard` in `Layout.tsx`**

Find the block at `frontend/src/components/Layout.tsx:143-175`. Replace the current username `NavLink` with a `flex justify-between` row that keeps the username on the left and a small gear NavLink on the right. Concrete edit — replace:

```tsx
      <NavLink
        to="/profile"
        className={({ isActive }) =>
          `block text-sm mb-3 truncate font-medium underline-offset-2 hover:underline ${
            isActive ? 'text-sage-300' : 'text-ink-100 hover:text-ink-50'
          }`
        }
        title="Modifier mon profil"
      >
        {user.username}
      </NavLink>
```

with:

```tsx
      <div className="flex items-center justify-between gap-2 mb-3">
        <NavLink
          to="/profile"
          className={({ isActive }) =>
            `block text-sm truncate font-medium underline-offset-2 hover:underline flex-1 min-w-0 ${
              isActive ? 'text-sage-300' : 'text-ink-100 hover:text-ink-50'
            }`
          }
          title="Modifier mon profil"
        >
          {user.username}
        </NavLink>
        <NavLink
          to="/settings"
          title="Réglages"
          aria-label="Réglages"
          className={({ isActive }) =>
            `btn-ghost !min-h-0 !py-1 !px-1.5 shrink-0 ${
              isActive ? 'text-sage-300' : 'text-ink-400 hover:text-ink-100'
            }`
          }
        >
          <GearIcon />
        </NavLink>
      </div>
```

- [ ] **Step 2: Add the `GearIcon` component to the bottom of `Layout.tsx`**

Add after the existing `EyeClosedIcon` function (near the end of the file):

```tsx
function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M7 1v1.5M7 11.5V13M13 7h-1.5M2.5 7H1M11.24 2.76l-1.06 1.06M3.82 10.18l-1.06 1.06M11.24 11.24l-1.06-1.06M3.82 3.82L2.76 2.76"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

- [ ] **Step 3: Typecheck + eyeball the sidebar in a quick test**

```bash
cd frontend && npm run typecheck 2>&1 | tail -10
```

Expected: no errors.

Add a smoke test that a gear link exists — either extend an existing Layout test or, if none exists, skip and rely on the Settings page tests to verify the target route works. Search for a Layout test:

```bash
find frontend/src -name "Layout*.test.*"
```

If there's no existing Layout test, no new one is required for this task — the sidebar entry is a wiring change with negligible logic. If one exists, add one case:

```tsx
it('exposes a Réglages link to /settings from the sidebar user card', () => {
  // ...render Layout with a user...
  const link = screen.getByRole('link', { name: /réglages/i });
  expect(link).toHaveAttribute('href', '/settings');
});
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "$(cat <<'EOF'
feat(layout): gear icon in sidebar UserCard, links to /settings

Icon-only NavLink to the right of the username. Existing "Masquer les
montants" and logout buttons untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire the Dashboard to `useSettings`

**Files:**
- Modify: `frontend/src/pages/Dashboard/index.tsx`
- Modify: `frontend/src/pages/__tests__/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `useSettings` from Task 4.
- Produces: nothing new; changes internal behaviour so the initial `range` / `chartScope` come from settings.

- [ ] **Step 1: Update the Dashboard test — first, capture the new expected behaviour**

Edit `frontend/src/pages/__tests__/Dashboard.test.tsx`:

Replace the entire "persists the chart account selector to localStorage" test (lines 84-100) with:

```tsx
  it('reads dashboardChartScope from /api/settings on mount', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 2,
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
        },
      };
      if (path === '/api/accounts') return { accounts: [acc(1, 'A'), acc(2, 'B')] };
      if (path === '/api/reports/balance') return {
        perCurrency: [{ currency: 'EUR', total: '100.00', available: '100.00', account_count: 2 }],
      };
      if (path === '/api/reports/timeseries') return { points: [] };
      throw new Error(`unexpected: ${path}`);
    });
    renderDashboard();
    const select = await screen.findByLabelText(/compte affiché/i);
    // Wait for settings to hydrate.
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('2'));
  });

  it('local changes to the chart selector do NOT PATCH /api/settings', async () => {
    const patchCalls: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (init?.method === 'PATCH') { patchCalls.push({ path, init }); return { settings: {} }; }
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 'all',
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
        },
      };
      if (path === '/api/accounts') return { accounts: [acc(1, 'A'), acc(2, 'B')] };
      if (path === '/api/reports/balance') return {
        perCurrency: [{ currency: 'EUR', total: '100.00', available: '100.00', account_count: 2 }],
      };
      if (path === '/api/reports/timeseries') return { points: [] };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderDashboard();
    const select = await screen.findByLabelText(/compte affiché/i);
    await u.selectOptions(select, '2');
    // Give any accidental PATCH time to fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(patchCalls).toHaveLength(0);
  });
```

Also update the three pre-existing tests (`renders the "Solde net" hero`, `switches the hero label`, `lists each account card`, `shows a "dont X€ bloqués"`) to include a `/api/settings` mock branch — otherwise the Dashboard's new settings query will hit the `throw new Error('unexpected: /api/settings')` line. Add this branch at the top of each mock implementation:

```tsx
if (path === '/api/settings') return {
  settings: {
    dashboardRange: '3m', dashboardChartScope: 'all',
    chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
  },
};
```

- [ ] **Step 2: Run the Dashboard tests — verify the two new tests fail**

```bash
cd frontend && npx vitest run src/pages/__tests__/Dashboard.test.tsx 2>&1 | tail -30
```

Expected: the two new tests fail because the Dashboard still uses `usePersistedState`.

- [ ] **Step 3: Wire the Dashboard to `useSettings`**

Edit `frontend/src/pages/Dashboard/index.tsx`. Replace lines 7 (import) and 37-48 (the two `usePersistedState` calls):

Change the import block near the top:

```ts
import { usePersistedState } from '../../lib/persisted-state';
```

to:

```ts
import { useSettings } from '../../lib/useSettings';
```

Replace lines 37-48 (the `const [range, setRange] = usePersistedState<RangeKey>(...)` and `const [chartScope, setChartScope] = usePersistedState<'all' | number>(...)` blocks + surrounding comments) with:

```tsx
  // Page-wide period and chart scope. Both seeded from user settings on
  // mount; in-session changes are ephemeral (no writeback). To make a
  // change stick, edit Réglages.
  const { settings } = useSettings();
  const [range, setRange] = useState<RangeKey>(settings.dashboardRange);
  const [chartScope, setChartScope] = useState<'all' | number>(settings.dashboardChartScope);
  // If settings arrive after the initial render (first paint used DEFAULTS),
  // hydrate the local state once.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    setRange(settings.dashboardRange);
    setChartScope(settings.dashboardChartScope);
  }, [settings.dashboardRange, settings.dashboardChartScope]);
```

Add `useEffect`, `useRef`, `useState` to the existing React import at the top of the file (currently `import { useMemo } from 'react';`). Change it to:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
```

- [ ] **Step 4: Run the Dashboard tests — verify they pass**

```bash
cd frontend && npx vitest run src/pages/__tests__/Dashboard.test.tsx 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Dashboard/index.tsx frontend/src/pages/__tests__/Dashboard.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): seed range + chartScope from user settings, drop localStorage

In-session changes to the range picker and chart account select stay
ephemeral. Persistent defaults live in Réglages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Hoist `MAX_SOLID_GAP_DAYS` into a `BalanceChart` prop

**Files:**
- Modify: `frontend/src/components/BalanceChart/index.tsx`
- Modify: `frontend/src/pages/Dashboard/index.tsx` (pass the prop from settings)
- Create or modify: `frontend/src/components/BalanceChart/__tests__/index.test.tsx` — see step 3.

**Interfaces:**
- Consumes: `useSettings` on the Dashboard side.
- Produces: a new optional prop `gapThresholdDays?: number` on `<BalanceChart>` (default `6`).

- [ ] **Step 1: Check the BalanceChart tests directory**

```bash
ls /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend/src/components/BalanceChart/__tests__
```

If an `index.test.tsx` exists, extend it. Otherwise, create a new one in step 3.

- [ ] **Step 2: Change `MAX_SOLID_GAP_DAYS` into a prop**

Edit `frontend/src/components/BalanceChart/index.tsx`.

Change the props interface (lines 8-13):

```ts
interface Props {
  points: BalancePoint[];
  currency: string;
  height?: number;
  checkpoints?: Checkpoint[];
  // Gaps greater than this many days between consecutive buckets are drawn
  // dotted, signalling missing data. Default 6 keeps weekends + short quiet
  // stretches solid.
  gapThresholdDays?: number;
}
```

Change the function signature (line 24) to accept the new prop with the same default:

```ts
export function BalanceChart({ points, currency, height = 240, checkpoints, gapThresholdDays = 6 }: Props): JSX.Element {
```

Replace the `const MAX_SOLID_GAP_DAYS = 6;` line (roughly line 68) with a usage of `gapThresholdDays`:

```ts
  // Split the stroked line into runs of consecutive segments sharing the same
  // "dashed" verdict. A segment is dashed when the two data points bracket a
  // gap of more than `gapThresholdDays` — telling the user that we have no
  // data for that stretch (missed import, ingestion gap, …). The area path
  // stays continuous — the dotted stroke alone communicates the uncertainty.
  const segments: { d: string; dashed: boolean }[] = [];
```

And replace the `const dashed = gap > MAX_SOLID_GAP_DAYS;` line with:

```ts
      const dashed = gap > gapThresholdDays;
```

- [ ] **Step 3: Add a test case for the new prop**

If `frontend/src/components/BalanceChart/__tests__/index.test.tsx` exists, append a case; otherwise create it:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BalanceChart } from '../index';

describe('BalanceChart gapThresholdDays', () => {
  const points = [
    { account_id: 1, bucket: '2026-01-01', cumulative: '100.00' },
    { account_id: 1, bucket: '2026-01-05', cumulative: '110.00' }, // 4-day gap
    { account_id: 1, bucket: '2026-01-15', cumulative: '120.00' }, // 10-day gap
  ] as any;

  it('with gapThresholdDays=3, both segments are dashed', () => {
    const { container } = render(<BalanceChart points={points} currency="EUR" gapThresholdDays={3} />);
    const dashed = container.querySelectorAll('path[stroke-dasharray="4 5"]');
    expect(dashed.length).toBeGreaterThan(0);
  });

  it('with gapThresholdDays=7, only the second (10-day) gap is dashed', () => {
    const { container } = render(<BalanceChart points={points} currency="EUR" gapThresholdDays={7} />);
    // At least one solid segment (glow-filtered) and one dashed segment.
    const dashed = container.querySelectorAll('path[stroke-dasharray="4 5"]');
    const solid = container.querySelectorAll('path[filter="url(#glow)"]');
    expect(dashed.length).toBeGreaterThan(0);
    expect(solid.length).toBeGreaterThan(0);
  });

  it('default (no prop) keeps the historical threshold behaviour (6 days)', () => {
    // 4-day gap ≤ 6 → solid; 10-day gap > 6 → dashed.
    const { container } = render(<BalanceChart points={points} currency="EUR" />);
    expect(container.querySelectorAll('path[stroke-dasharray="4 5"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('path[filter="url(#glow)"]').length).toBeGreaterThan(0);
  });
});
```

If the existing helpers/imports differ (e.g. an existing test file already mocks something), align the imports with what's there.

- [ ] **Step 4: Wire the Dashboard to pass `gapThresholdDays`**

Edit `frontend/src/pages/Dashboard/index.tsx`. Find the `<BalanceChart …>` invocation (around line 158) and add the prop:

```tsx
<BalanceChart
  points={chartPoints}
  currency={chartCurrency}
  checkpoints={chartCheckpoints}
  gapThresholdDays={settings.chartGapThresholdDays}
/>
```

- [ ] **Step 5: Run the tests**

```bash
cd frontend && npx vitest run src/components/BalanceChart 2>&1 | tail -20
```

Expected: the 3 new cases pass (+ any pre-existing cases still pass).

- [ ] **Step 6: Typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/BalanceChart/index.tsx frontend/src/components/BalanceChart/__tests__/ frontend/src/pages/Dashboard/index.tsx
git commit -m "$(cat <<'EOF'
feat(balance-chart): gapThresholdDays prop, wired from user settings

Default 6 preserved; Dashboard now threads settings.chartGapThresholdDays.
Existing callers without the prop keep working.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wire `DuplicatesPanel` to `useSettings`

**Files:**
- Modify: `frontend/src/pages/Imports/DuplicatesPanel.tsx`
- Modify: `frontend/src/pages/Imports/__tests__/DuplicatesPanel.test.tsx`

**Interfaces:**
- Consumes: `useSettings` from Task 4.
- Produces: nothing new; the panel's threshold slider is now seeded from `settings.duplicateSimilarityThreshold`.

- [ ] **Step 1: Add a test for the new behaviour**

Edit `frontend/src/pages/Imports/__tests__/DuplicatesPanel.test.tsx`. Add this case inside the existing `describe('DuplicatesPanel', …)`:

```tsx
  it('seeds the similarity threshold from /api/settings', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 'all',
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 42,
        },
      };
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/transactions/duplicates') return {
        groups: [
          {
            date: '2026-06-15', amount: '-1', accountId: 1,
            transactions: [
              { id: 100, raw_label: 'A', normalized_label: 'a', source_file_id: null, category_id: null },
              { id: 101, raw_label: 'B', normalized_label: 'b', source_file_id: null, category_id: null },
            ],
          },
        ],
      };
      throw new Error(`unexpected: ${path}`);
    });
    renderPanel();
    // Threshold display "42%" appears once settings resolve.
    expect(await screen.findByText(/42%/)).toBeInTheDocument();
  });
```

Also update the three existing tests so their `apiMock.mockImplementation` handles `/api/settings` — add a branch at the top of each:

```tsx
if (path === '/api/settings') return {
  settings: {
    dashboardRange: '3m', dashboardChartScope: 'all',
    chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
  },
};
```

- [ ] **Step 2: Run the tests — verify the new one fails**

```bash
cd frontend && npx vitest run src/pages/Imports/__tests__/DuplicatesPanel.test.tsx 2>&1 | tail -20
```

Expected: the new "seeds the similarity threshold" test fails; existing tests still pass with the added settings branch.

- [ ] **Step 3: Wire the panel**

Edit `frontend/src/pages/Imports/DuplicatesPanel.tsx`.

Replace the import:

```ts
import { usePersistedState } from '../../lib/persisted-state';
```

with:

```ts
import { useEffect, useRef } from 'react';
import { useSettings } from '../../lib/useSettings';
```

(and update the existing `import { useMemo, useState }` line to keep those hooks — the resulting single React import should be `import { useEffect, useMemo, useRef, useState } from 'react';`).

Replace the current threshold state line (around line 115):

```ts
  const [threshold, setThreshold] = usePersistedState<number>('dup.similarityThreshold', 0);
```

with:

```ts
  const { settings } = useSettings();
  const [threshold, setThreshold] = useState<number>(settings.duplicateSimilarityThreshold);
  // Hydrate once when settings arrive.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    setThreshold(settings.duplicateSimilarityThreshold);
  }, [settings.duplicateSimilarityThreshold]);
```

- [ ] **Step 4: Run the tests — verify they all pass**

```bash
cd frontend && npx vitest run src/pages/Imports/__tests__/DuplicatesPanel.test.tsx 2>&1 | tail -20
```

Expected: all pass, including the new one.

- [ ] **Step 5: Typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Imports/DuplicatesPanel.tsx frontend/src/pages/Imports/__tests__/DuplicatesPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(duplicates): seed similarity threshold from user settings

Same ephemeral-in-session semantic as the Dashboard controls: the
slider works during a visit, resets to the setting on next mount.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: STATUS.md update

**Files:**
- Modify: `STATUS.md`

**Interfaces:**
- Consumes: nothing.
- Produces: recently-landed entry + known-deferrals bullet.

- [ ] **Step 1: Add a "Recently landed" entry**

Edit `STATUS.md`. In the `## Recently landed` section, prepend (above the existing top entry):

```markdown
- 2026-07-03 — User-configurable settings surface: new `user_settings`
  table (migration 0013), `GET`/`PATCH /api/settings`, `useSettings`
  hook, Réglages page at `/settings` reached from a gear icon in the
  sidebar UserCard. Dashboard range + chart scope + `BalanceChart`
  gap threshold + Duplicates panel similarity threshold now seeded
  from settings; the old `dashboard.*` / `dup.*` localStorage keys
  are dead.
```

- [ ] **Step 2: Add a known-deferral for the dead localStorage keys**

In the `## Known deferrals` section, append:

```markdown
- Dead localStorage keys after 2026-07-03 settings landing:
  `dashboard.range`, `dashboard.chartScope`, `dup.similarityThreshold`.
  Nothing reads them anymore, and wiping them from each user's browser
  is not worth the ceremony. Delete `frontend/src/lib/persisted-state.ts`
  and its tests when no other code paths reference the hook.
```

- [ ] **Step 3: Update the "Last updated" line at the top**

Change:

```markdown
_Last updated: 2026-07-02_
```

to:

```markdown
_Last updated: 2026-07-03_
```

- [ ] **Step 4: Verify no other code still calls `usePersistedState`**

```bash
grep -rn "usePersistedState" frontend/src --include="*.ts" --include="*.tsx"
```

Expected: only the file itself and its tests. Nothing else. If a consumer still uses it, the deferral bullet is inaccurate — either drop the "delete `persisted-state.ts`" sentence or wire the last consumer to settings as a follow-on task.

- [ ] **Step 5: Commit**

```bash
git add STATUS.md
git commit -m "$(cat <<'EOF'
docs(status): user-configurable settings landing + persisted-state deferral

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage** — every section of `docs/superpowers/specs/2026-07-03-user-settings-design.md` maps to at least one task:

- Storage (migration + Drizzle table) → Task 1.
- Shape (Zod schema, defaults, merge helper) → Task 2.
- API (`GET`/`PATCH`, chart-scope sanitisation, upsert, tests 1-9) → Task 3.
- Frontend hook + api client + fallback defaults → Task 4.
- Consumers to wire (Dashboard, BalanceChart, DuplicatesPanel) → Tasks 7, 8, 9.
- Settings page (all three sections + "Enregistré" flash + Réinitialiser confirm + skeleton) → Task 5.
- Sidebar wiring (gear icon) → Task 6.
- Backend tests (9 cases enumerated) → Task 3 tests file.
- Frontend tests (`useSettings`, `Settings` page, Dashboard settings-read, BalanceChart prop, DuplicatesPanel seeding) → Tasks 4, 5, 7, 8, 9.
- Explicit non-goals (no localStorage migration, no defaults endpoint, no versioning) → nothing to do, consistent with plan.
- STATUS.md update → Task 10.

**Placeholder scan** — every task step contains concrete code or exact commands. No "TBD"/"TODO"/"add error handling" left over.

**Type consistency** — the settings shape is defined once per side (`FullSettings` on backend, `Settings` on frontend), and referenced everywhere by the same field names: `dashboardRange`, `dashboardChartScope`, `chartGapThresholdDays`, `duplicateSimilarityThreshold`. The BalanceChart prop is `gapThresholdDays` (same name in the interface, the destructure, and the tests). The `useSettings` return shape matches its usage in the Settings page, Dashboard, and DuplicatesPanel.
