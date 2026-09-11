# Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a notification system that alerts the user in-app, on the OS (Tauri), and in the browser (Web Notifications) when accounting events matter — big transactions, low balances, blown budget envelopes, bank-sync failures — with a privacy toggle that redacts amounts and merchant names from OS/browser surfaces.

**Architecture:** Server-driven pipeline. Domain code calls a single `emitNotification()` helper that persists to a new `notifications` table and broadcasts on an in-process bus. A Server-Sent Events endpoint fans the events out to a browser/Tauri client that dispatches them to three channel adapters (toast, Tauri OS, Web Notifications). Preferences live inside the existing `user_settings.settings` JSONB.

**Tech Stack:** Fastify v5 + Drizzle + Postgres/PGlite (backend), React 18 + Vite + Tailwind + react-query + react-i18next (frontend), Tauri 2 with `tauri-plugin-notification` (desktop), Vitest + Playwright (tests).

**Spec:** `docs/superpowers/specs/2026-09-01-notification-system-design.md`

## Global Constraints

- No cloud dependency — LAN-only self-hosted; no SMTP, FCM, or APNs.
- French decimal inputs — never `<input type="number">`; use text + `inputMode="decimal"` + the project `parseDecimal` helper.
- Frontend files max 300 lines (ESLint `max-lines` is a CI error).
- Public-safe commits — no IPs, hostnames, or secrets.
- Attribution: Git commits with `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`.
- Work on `main` directly; push only when the user asks.
- Run `cd backend && npx vitest run` and `cd frontend && npx vitest run` before any push.

---

### Task 1: Schema, migration, and shared types

**Files:**
- Modify: `backend/src/db/schema.ts` (add `notifications` table)
- Create: `backend/src/db/migrations/0040_notifications.sql`
- Modify: `shared/api-contracts.ts` (add `NotificationKind`, `NotificationPayload`, `Notification`)
- Test: `backend/tests/notifications-schema.test.ts`

**Interfaces:**
- Consumes: existing `users` table, existing Drizzle setup.
- Produces:
  - `notifications` Drizzle table with columns `id`, `userId`, `kind`, `payload`, `readAt`, `createdAt`, `idempotency`.
  - Type `NotificationKind = 'big_transaction' | 'account_low' | 'envelope_exceeded' | 'bank_sync_failed' | 'test'`.
  - Discriminated union `NotificationPayload` (per-kind shapes from the spec).
  - `Notification` — the wire row shape returned by list/stream endpoints.

- [ ] **Step 1: Add the Drizzle table**

In `backend/src/db/schema.ts`, after the existing `userSettings` table:

```ts
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    idempotency: text('idempotency').notNull(),
  },
  (t) => ({
    userCreatedIdx: index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
    userIdempotencyUq: uniqueIndex('notifications_user_idempotency_uq').on(t.userId, t.idempotency),
  }),
);
```

If `index`, `uniqueIndex`, `jsonb`, `text`, `timestamp`, `serial`, `integer` aren't already imported at the top of `schema.ts`, add them to the drizzle-orm/pg-core import.

- [ ] **Step 2: Write the migration SQL**

`backend/src/db/migrations/0040_notifications.sql`:

```sql
CREATE TABLE "notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "idempotency" text NOT NULL
);
CREATE INDEX "notifications_user_created_idx" ON "notifications" ("user_id", "created_at" DESC);
CREATE UNIQUE INDEX "notifications_user_idempotency_uq" ON "notifications" ("user_id", "idempotency");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
```

Verify against Drizzle's generator by running `cd backend && npx drizzle-kit generate`; if the generator produces a different filename or diff, use that output instead and delete the hand-written file.

- [ ] **Step 3: Add shared types**

In `shared/api-contracts.ts`, add:

```ts
export type NotificationKind =
  | 'big_transaction'
  | 'account_low'
  | 'envelope_exceeded'
  | 'bank_sync_failed'
  | 'test';

export type NotificationPayload =
  | { kind: 'big_transaction'; single: { txId: number; accountId: number; amount: number; merchant: string | null } }
  | { kind: 'big_transaction'; summary: { accountId: number; count: number; total: number } }
  | { kind: 'account_low'; accountId: number; balance: number; floor: number }
  | { kind: 'envelope_exceeded'; categoryId: number; envelope: number; spent: number; month: string }
  | { kind: 'bank_sync_failed'; accountId: number; reason: string }
  | { kind: 'test' };

export interface Notification {
  id: number;
  kind: NotificationKind;
  payload: NotificationPayload;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}
```

- [ ] **Step 4: Write the schema smoke test**

`backend/tests/notifications-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { notifications } from '../src/db/schema.js';

describe('notifications table', () => {
  it('exposes the expected columns', () => {
    const cols = Object.keys((notifications as unknown as { _: { columns: Record<string, unknown> } })._.columns);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'userId', 'kind', 'payload', 'readAt', 'createdAt', 'idempotency',
    ]));
  });
});
```

- [ ] **Step 5: Run tests**

```
cd backend && npx vitest run notifications-schema
```
Expected: PASS.

- [ ] **Step 6: Commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add backend/src/db/schema.ts backend/src/db/migrations/0040_notifications.sql \
      shared/api-contracts.ts backend/tests/notifications-schema.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(notifications): schema, migration, and shared types"
```

---

### Task 2: Extend settings schema with notification preferences

**Files:**
- Modify: `backend/src/domain/settings/schema.ts`
- Modify: `backend/src/domain/settings/defaults.ts`
- Test: `backend/src/domain/settings/__tests__/notifications.test.ts`

**Interfaces:**
- Consumes: existing `SettingsSchema`, `DEFAULTS`, `mergeSettings`.
- Produces:
  - `settings.notifications` sub-object accessible via `mergeSettings()`.
  - `FullSettings['notifications']` type covering `enabled`, `channels`, `privacy`, `triggers`.

- [ ] **Step 1: Write the failing test**

`backend/src/domain/settings/__tests__/notifications.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeSettings } from '../schema.js';

describe('settings.notifications', () => {
  it('defaults are privacy-safe and enabled', () => {
    const s = mergeSettings({});
    expect(s.notifications.enabled).toBe(true);
    expect(s.notifications.privacy.hideAmount).toBe(true);
    expect(s.notifications.privacy.hideMerchant).toBe(true);
    expect(s.notifications.channels.toast).toBe(true);
    expect(s.notifications.channels.osNative).toBe(false);
    expect(s.notifications.channels.webPush).toBe(false);
  });

  it('accepts a per-account threshold map', () => {
    const s = mergeSettings({
      notifications: { triggers: { bigTransaction: { enabled: true, thresholds: { '3': 500 } } } },
    });
    expect(s.notifications.triggers.bigTransaction.thresholds['3']).toBe(500);
  });

  it('rejects an unknown top-level key', () => {
    const s = mergeSettings({ notifications: { evil: true } });
    // strict schema drops the unknown branch and returns defaults
    expect(s.notifications.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```
cd backend && npx vitest run src/domain/settings/__tests__/notifications
```
Expected: FAIL (schema doesn't yet expose `notifications`).

- [ ] **Step 3: Extend the schema**

In `backend/src/domain/settings/schema.ts`, add above `SettingsSchema`:

```ts
const AccountIdKeyed = z.record(z.string().regex(/^\d+$/), z.number().nonnegative());

const NotificationsSchema = z.object({
  enabled: z.boolean().optional(),
  channels: z.object({
    toast:    z.boolean().optional(),
    osNative: z.boolean().optional(),
    webPush:  z.boolean().optional(),
  }).partial().optional(),
  privacy: z.object({
    hideAmount:   z.boolean().optional(),
    hideMerchant: z.boolean().optional(),
  }).partial().optional(),
  triggers: z.object({
    bigTransaction:   z.object({ enabled: z.boolean().optional(), thresholds: AccountIdKeyed.optional() }).optional(),
    accountLow:       z.object({ enabled: z.boolean().optional(), floors:     AccountIdKeyed.optional() }).optional(),
    envelopeExceeded: z.object({ enabled: z.boolean().optional() }).optional(),
    bankSyncFailed:   z.object({ enabled: z.boolean().optional() }).optional(),
  }).partial().optional(),
}).strict();
```

Add `notifications: NotificationsSchema.optional(),` inside `SettingsSchema`.

Add to `FullSettings`:

```ts
notifications: {
  enabled: boolean;
  channels: { toast: boolean; osNative: boolean; webPush: boolean };
  privacy:  { hideAmount: boolean; hideMerchant: boolean };
  triggers: {
    bigTransaction:   { enabled: boolean; thresholds: Record<string, number> };
    accountLow:       { enabled: boolean; floors:     Record<string, number> };
    envelopeExceeded: { enabled: boolean };
    bankSyncFailed:   { enabled: boolean };
  };
};
```

Update `mergeSettings` so that when the parsed `notifications` is partial, missing keys inherit from `DEFAULTS.notifications` at every level. The simplest correct implementation is a small local `mergeNotifications(stored, patch)` that runs after `Object.assign(safe, parsed.data)` and again after `Object.assign(safe, patch)` — replace the shallow `Object.assign` for that one key with the deep merge.

- [ ] **Step 4: Add defaults**

In `backend/src/domain/settings/defaults.ts`, add to `DEFAULTS`:

```ts
notifications: {
  enabled: true,
  channels: { toast: true, osNative: false, webPush: false },
  privacy:  { hideAmount: true, hideMerchant: true },
  triggers: {
    bigTransaction:   { enabled: true, thresholds: {} },
    accountLow:       { enabled: true, floors:     {} },
    envelopeExceeded: { enabled: true },
    bankSyncFailed:   { enabled: true },
  },
},
```

- [ ] **Step 5: Run tests, iterate until green**

```
cd backend && npx vitest run src/domain/settings
```
Expected: PASS.

- [ ] **Step 6: Commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add backend/src/domain/settings/schema.ts backend/src/domain/settings/defaults.ts \
      backend/src/domain/settings/__tests__/notifications.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(settings): notification preferences with privacy-safe defaults"
```

---

### Task 3: Render module — privacy-aware title and body

**Files:**
- Create: `backend/src/domain/notifications/render.ts`
- Test: `backend/src/domain/notifications/__tests__/render.test.ts`

**Interfaces:**
- Consumes: `NotificationPayload` from Task 1, `FullSettings['notifications']['privacy']` from Task 2.
- Produces:
  - `renderTitle(payload: NotificationPayload, privacy: { hideAmount: boolean; hideMerchant: boolean }): string`
  - `renderBody (payload: NotificationPayload, privacy: { hideAmount: boolean; hideMerchant: boolean }): string`
  - `renderFullDetail(payload: NotificationPayload): { title: string; body: string }` — inbox path, never redacted.

- [ ] **Step 1: Write the failing test**

`backend/src/domain/notifications/__tests__/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderTitle, renderBody, renderFullDetail } from '../render.js';

const privacyOn  = { hideAmount: true,  hideMerchant: true };
const privacyOff = { hideAmount: false, hideMerchant: false };

describe('render', () => {
  it('big_transaction summary hides amount', () => {
    const p = { kind: 'big_transaction' as const, summary: { accountId: 1, count: 4, total: 1200 } };
    expect(renderBody(p, privacyOn)).not.toMatch(/1,200|1200/);
    expect(renderBody(p, privacyOff)).toMatch(/1,200|1200/);
  });

  it('big_transaction single hides merchant', () => {
    const p = { kind: 'big_transaction' as const, single: { txId: 2, accountId: 1, amount: 842.3, merchant: 'Carrefour' } };
    expect(renderBody(p, privacyOn)).not.toContain('Carrefour');
    expect(renderBody(p, privacyOff)).toContain('Carrefour');
  });

  it('inbox rendering always shows full detail', () => {
    const p = { kind: 'big_transaction' as const, single: { txId: 2, accountId: 1, amount: 842.3, merchant: 'Carrefour' } };
    const { body } = renderFullDetail(p);
    expect(body).toContain('Carrefour');
    expect(body).toMatch(/842/);
  });
});
```

- [ ] **Step 2: Run and confirm fail**

```
cd backend && npx vitest run src/domain/notifications/__tests__/render
```

- [ ] **Step 3: Implement the render module**

`backend/src/domain/notifications/render.ts`:

```ts
import type { NotificationPayload } from '../../../../shared/api-contracts.js';

type Privacy = { hideAmount: boolean; hideMerchant: boolean };

const amount = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

export function renderTitle(p: NotificationPayload, _priv: Privacy): string {
  switch (p.kind) {
    case 'big_transaction':      return 'Big transaction';
    case 'account_low':          return 'Account balance low';
    case 'envelope_exceeded':    return 'Budget exceeded';
    case 'bank_sync_failed':     return 'Bank sync failed';
    case 'test':                 return 'Test notification';
  }
}

export function renderBody(p: NotificationPayload, priv: Privacy): string {
  switch (p.kind) {
    case 'big_transaction': {
      if ('summary' in p) {
        const total = priv.hideAmount ? '' : ` (${amount(p.summary.total)})`;
        return `${p.summary.count} big transactions on account #${p.summary.accountId}${total}`;
      }
      const merchant = !priv.hideMerchant && p.single.merchant ? ` at ${p.single.merchant}` : '';
      const money    = priv.hideAmount ? '' : `${amount(p.single.amount)} `;
      return `${money}on account #${p.single.accountId}${merchant}`.trim() || 'A big transaction was recorded';
    }
    case 'account_low': {
      const balance = priv.hideAmount ? '' : ` (${amount(p.balance)})`;
      return `Account #${p.accountId} dipped below its floor${balance}`;
    }
    case 'envelope_exceeded': {
      const money = priv.hideAmount ? '' : ` — ${amount(p.spent)} of ${amount(p.envelope)}`;
      return `Category #${p.categoryId} over budget for ${p.month}${money}`;
    }
    case 'bank_sync_failed':
      return `Sync failed for account #${p.accountId}: ${p.reason}`;
    case 'test':
      return 'This is a test — if you see it, the pipeline works.';
  }
}

export function renderFullDetail(p: NotificationPayload): { title: string; body: string } {
  return {
    title: renderTitle(p, { hideAmount: false, hideMerchant: false }),
    body:  renderBody (p, { hideAmount: false, hideMerchant: false }),
  };
}
```

- [ ] **Step 4: Run to green**

```
cd backend && npx vitest run src/domain/notifications
```

- [ ] **Step 5: Commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add backend/src/domain/notifications/render.ts backend/src/domain/notifications/__tests__/render.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(notifications): privacy-aware render module"
```

---

### Task 4: In-process bus

**Files:**
- Create: `backend/src/domain/notifications/bus.ts`
- Test: `backend/src/domain/notifications/__tests__/bus.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type BusEvent = { row: Notification }` (uses `Notification` from Task 1).
  - `subscribe(userId: number, cb: (e: BusEvent) => void): () => void` — returns unsubscribe.
  - `broadcast(userId: number, e: BusEvent): void`.

- [ ] **Step 1: Write the failing test**

`backend/src/domain/notifications/__tests__/bus.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { subscribe, broadcast } from '../bus.js';

describe('bus', () => {
  it('delivers events only to subscribers of the same userId', () => {
    const a = vi.fn();
    const b = vi.fn();
    const off1 = subscribe(1, a);
    const off2 = subscribe(2, b);
    broadcast(1, { row: { id: 1 } as any });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    off1(); off2();
  });

  it('unsubscribe stops delivery', () => {
    const cb = vi.fn();
    const off = subscribe(3, cb);
    off();
    broadcast(3, { row: { id: 2 } as any });
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and confirm fail**

- [ ] **Step 3: Implement**

`backend/src/domain/notifications/bus.ts`:

```ts
import type { Notification } from '../../../../shared/api-contracts.js';

export type BusEvent = { row: Notification };
type Sub = (e: BusEvent) => void;

const subs = new Map<number, Set<Sub>>();

export function subscribe(userId: number, cb: Sub): () => void {
  let set = subs.get(userId);
  if (!set) { set = new Set(); subs.set(userId, set); }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) subs.delete(userId);
  };
}

export function broadcast(userId: number, e: BusEvent): void {
  const set = subs.get(userId);
  if (!set) return;
  for (const cb of set) {
    try { cb(e); } catch { /* swallow; a broken subscriber must not block peers */ }
  }
}
```

- [ ] **Step 4: Run to green**

```
cd backend && npx vitest run src/domain/notifications/__tests__/bus
```

- [ ] **Step 5: Commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add backend/src/domain/notifications/bus.ts backend/src/domain/notifications/__tests__/bus.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(notifications): in-process pub/sub bus"
```

---

### Task 5: Emit module — persist + broadcast + idempotency + prefs gate

**Files:**
- Create: `backend/src/domain/notifications/emit.ts`
- Test: `backend/src/domain/notifications/__tests__/emit.test.ts` (DB-integration; skipped unless `RUN_DB_TESTS=1`)

**Interfaces:**
- Consumes: `notifications` table, `mergeSettings`, `renderFullDetail` from Task 3, `broadcast` from Task 4.
- Produces:
  - `emitNotification(userId, kind, payload, opts?: { idempotency?: string }): Promise<Notification | null>` — returns the row (or `null` when short-circuited by prefs or dedup).
  - `triggerEnabledFor(kind, prefs)` — internal helper, not exported.

- [ ] **Step 1: Write the failing test**

`backend/src/domain/notifications/__tests__/emit.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../db/client.js';
import { notifications, userSettings } from '../../../db/schema.js';
import { eq } from 'drizzle-orm';
import { emitNotification } from '../emit.js';
import { seedUser } from '../../../../tests/helpers/seedUser.js'; // reuse existing helper

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

d('emitNotification (db)', () => {
  let uid: number;
  beforeEach(async () => {
    uid = await seedUser();
    await db.delete(notifications).where(eq(notifications.userId, uid));
  });

  it('persists a row and returns it', async () => {
    const row = await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 't1' });
    expect(row).not.toBeNull();
    const rows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(rows).toHaveLength(1);
  });

  it('is idempotent on repeat idempotency key', async () => {
    await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 't2' });
    const second = await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 't2' });
    expect(second).toBeNull();
    const rows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(rows).toHaveLength(1);
  });

  it('short-circuits when master switch is off', async () => {
    await db.update(userSettings)
      .set({ settings: { notifications: { enabled: false } } })
      .where(eq(userSettings.userId, uid));
    const row = await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 't3' });
    expect(row).toBeNull();
  });
});
```

If `tests/helpers/seedUser.ts` doesn't exist, use whichever fixture helper the existing route tests use (grep `beforeEach.*user` under `backend/tests/`).

- [ ] **Step 2: Run and confirm fail (or skip)**

```
cd backend && RUN_DB_TESTS=1 npx vitest run src/domain/notifications/__tests__/emit
```

- [ ] **Step 3: Implement**

`backend/src/domain/notifications/emit.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { notifications, userSettings } from '../../db/schema.js';
import { mergeSettings } from '../settings/schema.js';
import { renderFullDetail } from './render.js';
import { broadcast } from './bus.js';
import type { Notification, NotificationKind, NotificationPayload } from '../../../../shared/api-contracts.js';

function triggerKey(kind: NotificationKind): keyof ReturnType<typeof mergeSettings>['notifications']['triggers'] | null {
  switch (kind) {
    case 'big_transaction':   return 'bigTransaction';
    case 'account_low':       return 'accountLow';
    case 'envelope_exceeded': return 'envelopeExceeded';
    case 'bank_sync_failed':  return 'bankSyncFailed';
    case 'test':              return null;
  }
}

export async function emitNotification(
  userId: number,
  kind: NotificationKind,
  payload: NotificationPayload,
  opts: { idempotency?: string } = {},
): Promise<Notification | null> {
  const [row] = await db.select({ settings: userSettings.settings })
    .from(userSettings).where(eq(userSettings.userId, userId));
  const prefs = mergeSettings(row?.settings ?? {}).notifications;
  if (!prefs.enabled) return null;
  const tk = triggerKey(kind);
  if (tk && !prefs.triggers[tk].enabled) return null;

  const idempotency = opts.idempotency ?? `${kind}:${Date.now()}:${Math.random()}`;
  const inserted = await db.insert(notifications)
    .values({ userId, kind, payload, idempotency })
    .onConflictDoNothing({ target: [notifications.userId, notifications.idempotency] })
    .returning();
  if (inserted.length === 0) return null;

  const { title, body } = renderFullDetail(payload);
  const out: Notification = {
    id: inserted[0].id,
    kind,
    payload,
    title,
    body,
    readAt: null,
    createdAt: inserted[0].createdAt.toISOString(),
  };
  broadcast(userId, { row: out });
  return out;
}
```

- [ ] **Step 4: Run to green**

```
cd backend && RUN_DB_TESTS=1 npx vitest run src/domain/notifications/__tests__/emit
```

- [ ] **Step 5: Commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add backend/src/domain/notifications/emit.ts backend/src/domain/notifications/__tests__/emit.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(notifications): emit with prefs gate and idempotency dedup"
```

---

### Task 6: Batcher — coalesce bursts per `(userId, batchKey)`

**Files:**
- Create: `backend/src/domain/notifications/batcher.ts`
- Test: `backend/src/domain/notifications/__tests__/batcher.test.ts`

**Interfaces:**
- Consumes: `emitNotification` from Task 5 (injected for testability).
- Produces:
  - `queueBatched(userId: number, batchKey: string, item: { accountId: number; amount: number }): void`
  - `flushBatch(userId: number, batchKey: string): Promise<void>`
  - `__setEmitter(fn: EmitFn): void` — test seam.
  - Timer constants exported for the test to override: `IDLE_MS = 2000`, `MAX_ITEMS = 10`.

- [ ] **Step 1: Write the failing test**

`backend/src/domain/notifications/__tests__/batcher.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queueBatched, flushBatch, __setEmitter, IDLE_MS, MAX_ITEMS } from '../batcher.js';

describe('batcher', () => {
  const emit = vi.fn(async () => null);
  beforeEach(() => { __setEmitter(emit); emit.mockClear(); vi.useFakeTimers(); });

  it('flushes after IDLE_MS with a summary payload', async () => {
    queueBatched(1, 'bt:9', { accountId: 9, amount: 500 });
    queueBatched(1, 'bt:9', { accountId: 9, amount: 700 });
    await vi.advanceTimersByTimeAsync(IDLE_MS + 10);
    expect(emit).toHaveBeenCalledTimes(1);
    const [uid, kind, payload] = emit.mock.calls[0];
    expect(uid).toBe(1);
    expect(kind).toBe('big_transaction');
    expect((payload as any).summary).toEqual({ accountId: 9, count: 2, total: 1200 });
  });

  it('flushes immediately at MAX_ITEMS', async () => {
    for (let i = 0; i < MAX_ITEMS; i++) queueBatched(2, 'bt:1', { accountId: 1, amount: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(emit).toHaveBeenCalledTimes(1);
    expect((emit.mock.calls[0][2] as any).summary.count).toBe(MAX_ITEMS);
  });

  it('emits a single (not summary) when only one item ever queued', async () => {
    queueBatched(3, 'bt:2', { accountId: 2, amount: 999 });
    await flushBatch(3, 'bt:2');
    expect(emit).toHaveBeenCalledTimes(1);
    expect((emit.mock.calls[0][2] as any).single).toBeUndefined(); // batcher always summarises
  });
});
```

- [ ] **Step 2: Run and confirm fail**

- [ ] **Step 3: Implement**

`backend/src/domain/notifications/batcher.ts`:

```ts
import type { NotificationKind, NotificationPayload } from '../../../../shared/api-contracts.js';
import { emitNotification } from './emit.js';

export const IDLE_MS = 2000;
export const MAX_ITEMS = 10;

type EmitFn = (uid: number, k: NotificationKind, p: NotificationPayload, o?: { idempotency?: string }) => Promise<unknown>;
let emitter: EmitFn = emitNotification;
export function __setEmitter(fn: EmitFn) { emitter = fn; }

type Buffer = { items: { accountId: number; amount: number }[]; timer: ReturnType<typeof setTimeout> | null };
const buffers = new Map<string, Buffer>();
const key = (uid: number, batchKey: string) => `${uid}::${batchKey}`;

export function queueBatched(userId: number, batchKey: string, item: { accountId: number; amount: number }): void {
  const k = key(userId, batchKey);
  let buf = buffers.get(k);
  if (!buf) { buf = { items: [], timer: null }; buffers.set(k, buf); }
  buf.items.push(item);
  if (buf.timer) clearTimeout(buf.timer);
  if (buf.items.length >= MAX_ITEMS) { void flushBatch(userId, batchKey); return; }
  buf.timer = setTimeout(() => { void flushBatch(userId, batchKey); }, IDLE_MS);
}

export async function flushBatch(userId: number, batchKey: string): Promise<void> {
  const k = key(userId, batchKey);
  const buf = buffers.get(k);
  if (!buf) return;
  buffers.delete(k);
  if (buf.timer) clearTimeout(buf.timer);
  if (buf.items.length === 0) return;
  const accountId = buf.items[0].accountId;
  const total = buf.items.reduce((s, i) => s + i.amount, 0);
  const idempotency = `bt:${accountId}:${new Date().toISOString().slice(0, 10)}:${Date.now()}`;
  await emitter(userId, 'big_transaction', { kind: 'big_transaction', summary: { accountId, count: buf.items.length, total } }, { idempotency });
}
```

- [ ] **Step 4: Run to green**

```
cd backend && npx vitest run src/domain/notifications/__tests__/batcher
```

- [ ] **Step 5: Commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add backend/src/domain/notifications/batcher.ts backend/src/domain/notifications/__tests__/batcher.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(notifications): burst batcher with idle + max-items flush"
```

---

### Task 7: HTTP routes — CRUD, unread-count, test, stream

**Files:**
- Create: `backend/src/http/routes/notifications/index.ts`
- Create: `backend/src/http/routes/notifications/stream.ts`
- Modify: `backend/src/buildServer.ts` (register the routes)
- Test: `backend/tests/notifications-routes.test.ts` (DB-integration; `RUN_DB_TESTS=1`)

**Interfaces:**
- Consumes: `emitNotification`, `subscribe`, `mergeSettings`, `notifications` table, existing `requireAuth`, `userId(req)`.
- Produces (HTTP surface):
  - `GET  /api/notifications?unread=1&kind=big_transaction&limit=50&cursor=<id>` → `{ items: Notification[]; nextCursor: number | null }`
  - `GET  /api/notifications/unread-count` → `{ count: number }`
  - `POST /api/notifications/:id/read` → `204`
  - `POST /api/notifications/read-all` → `204`
  - `DELETE /api/notifications/:id` → `204`
  - `POST /api/notifications/test` → `201` + body: `Notification`
  - `GET  /api/notifications/stream` → `text/event-stream`

- [ ] **Step 1: Write the failing route test**

`backend/tests/notifications-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/buildServer.js';
import { emitNotification } from '../src/domain/notifications/emit.js';
import { seedUserAndCookie } from './helpers/seedUserAndCookie.js'; // reuse existing pattern
const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

d('notifications routes', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let cookie: string, uid: number;
  beforeAll(async () => {
    app = await buildServer();
    ({ cookie, uid } = await seedUserAndCookie(app));
  });

  it('lists notifications with unread filter', async () => {
    await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 'route-1' });
    const r = await app.inject({ method: 'GET', url: '/api/notifications?unread=1', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().items).toHaveLength(1);
  });

  it('POST /:id/read marks read', async () => {
    const emitted = await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 'route-2' });
    const r = await app.inject({ method: 'POST', url: `/api/notifications/${emitted!.id}/read`, headers: { cookie } });
    expect(r.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: `/api/notifications?unread=1`, headers: { cookie } });
    expect(list.json().items.find((n: any) => n.id === emitted!.id)).toBeUndefined();
  });

  it('POST /test creates a real inbox row', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/notifications/test', headers: { cookie } });
    expect(r.statusCode).toBe(201);
    expect(r.json().kind).toBe('test');
  });
});
```

- [ ] **Step 2: Run and confirm fail**

- [ ] **Step 3: Implement the CRUD file**

`backend/src/http/routes/notifications/index.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { notifications } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { emitNotification } from '../../../domain/notifications/emit.js';
import { renderFullDetail } from '../../../domain/notifications/render.js';
import type { Notification, NotificationPayload } from '../../../../../shared/api-contracts.js';

const listQuery = z.object({
  unread: z.enum(['1']).optional(),
  kind: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().optional(),
});

function toWire(row: typeof notifications.$inferSelect): Notification {
  const { title, body } = renderFullDetail(row.payload as NotificationPayload);
  return {
    id: row.id,
    kind: row.kind as Notification['kind'],
    payload: row.payload as NotificationPayload,
    title, body,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/notifications', async (req) => {
    const q = listQuery.parse(req.query);
    const uid = userId(req);
    const rows = await db.select().from(notifications)
      .where(and(
        eq(notifications.userId, uid),
        q.unread ? sql`${notifications.readAt} IS NULL` : sql`true`,
        q.kind   ? eq(notifications.kind, q.kind)      : sql`true`,
        q.cursor ? lt(notifications.id, q.cursor)      : sql`true`,
      ))
      .orderBy(desc(notifications.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(toWire);
    const nextCursor = rows.length > q.limit ? rows[q.limit - 1].id : null;
    return { items, nextCursor };
  });

  app.get('/api/notifications/unread-count', async (req) => {
    const uid = userId(req);
    const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(notifications)
      .where(and(eq(notifications.userId, uid), sql`${notifications.readAt} IS NULL`));
    return { count: r?.c ?? 0 };
  });

  app.post('/api/notifications/:id/read', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad_id' });
    await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId(req))));
    return reply.code(204).send();
  });

  app.post('/api/notifications/read-all', async (req, reply) => {
    await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId(req)), sql`${notifications.readAt} IS NULL`));
    return reply.code(204).send();
  });

  app.delete('/api/notifications/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad_id' });
    await db.delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId(req))));
    return reply.code(204).send();
  });

  app.post('/api/notifications/test', async (req, reply) => {
    const row = await emitNotification(userId(req), 'test', { kind: 'test' },
      { idempotency: `test:${Date.now()}` });
    return reply.code(201).send(row);
  });
}
```

- [ ] **Step 4: Implement the SSE file**

`backend/src/http/routes/notifications/stream.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { subscribe } from '../../../domain/notifications/bus.js';
import { userId } from '../../plugins/auth.js';
import { db } from '../../../db/client.js';
import { notifications } from '../../../db/schema.js';
import { and, eq, gt, sql } from 'drizzle-orm';
import { renderFullDetail } from '../../../domain/notifications/render.js';
import type { NotificationPayload } from '../../../../../shared/api-contracts.js';

export async function notificationsStreamRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/notifications/stream', async (req, reply) => {
    const uid = userId(req);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 15000\n\n');

    // Replay last 60s of unread rows so reconnect gaps don't lose events.
    const cutoff = new Date(Date.now() - 60_000);
    const recent = await db.select().from(notifications)
      .where(and(eq(notifications.userId, uid), sql`${notifications.readAt} IS NULL`, gt(notifications.createdAt, cutoff)))
      .orderBy(notifications.id);
    for (const r of recent) {
      const { title, body } = renderFullDetail(r.payload as NotificationPayload);
      reply.raw.write(`data: ${JSON.stringify({
        id: r.id, kind: r.kind, payload: r.payload, title, body,
        readAt: null, createdAt: r.createdAt.toISOString(),
      })}\n\n`);
    }

    const off = subscribe(uid, (e) => {
      reply.raw.write(`data: ${JSON.stringify(e.row)}\n\n`);
    });
    const ping = setInterval(() => { reply.raw.write(': ping\n\n'); }, 25_000);

    req.raw.on('close', () => { clearInterval(ping); off(); reply.raw.end(); });
  });
}
```

- [ ] **Step 5: Register both in `buildServer.ts`**

Grep `notificationsRoutes` isn't there yet — add near existing `settingsRoutes` registration:

```ts
import { notificationsRoutes } from './http/routes/notifications/index.js';
import { notificationsStreamRoutes } from './http/routes/notifications/stream.js';
// …
await app.register(notificationsRoutes);
await app.register(notificationsStreamRoutes);
```

- [ ] **Step 6: Run to green**

```
cd backend && RUN_DB_TESTS=1 npx vitest run notifications-routes
```

- [ ] **Step 7: Commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add backend/src/http/routes/notifications/ backend/src/buildServer.ts \
      backend/tests/notifications-routes.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(notifications): CRUD + SSE stream routes"
```

---

### Task 8: Wire trigger call sites (four call sites, one commit)

**Files:**
- Modify: `backend/src/domain/imports/commitImport.ts` (or wherever `commitImport` lives; grep first)
- Modify: the direct-insert transaction route(s) in `backend/src/http/routes/transactions/`
- Modify: `backend/src/domain/bank-sync/` (grep for the finalize/error site)
- Modify: `backend/src/domain/envelopes/` — or create `backend/src/domain/notifications/envelope-check.ts` if the envelope module has no natural home for it
- Test: `backend/tests/notifications-triggers.test.ts` (DB-integration)

**Interfaces:**
- Consumes: `emitNotification`, `queueBatched`, `flushBatch`, `mergeSettings`.
- Produces: no exports — pure side-effect wiring.

- [ ] **Step 1: Write the failing integration tests (one per trigger)**

`backend/tests/notifications-triggers.test.ts` (skeleton — mirror the pattern in existing multi-scenario tests like `accounts-merge.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/buildServer.js';
import { seedUserAndCookie, seedAccount } from './helpers/seedUserAndCookie.js';
import { db } from '../src/db/client.js';
import { notifications, userSettings } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

d('notification triggers', () => {
  it('inserting a transaction above threshold queues a big_transaction batch', async () => {
    const app = await buildServer();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);
    await db.update(userSettings)
      .set({ settings: { notifications: { triggers: { bigTransaction: { enabled: true, thresholds: { [String(accountId)]: 500 } } } } } })
      .where(eq(userSettings.userId, uid));
    // POST transaction of 800€ on that account (use the existing insert route)
    await app.inject({ method: 'POST', url: '/api/transactions',
      headers: { cookie }, payload: { accountId, amount: -800, date: '2026-09-01', merchant: 'Test Store' } });
    // Wait past IDLE_MS to let the batcher flush
    await new Promise(r => setTimeout(r, 2200));
    const rows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(rows.some(r => r.kind === 'big_transaction')).toBe(true);
  });

  // Repeat pattern for account_low, envelope_exceeded, bank_sync_failed.
});
```

- [ ] **Step 2: Grep for the four call sites**

```
grep -RnE 'commitImport|insert into transactions|db\.insert\(transactions' backend/src
grep -Rn 'needs_reconnect\|onSyncError\|syncFail' backend/src/domain/bank-sync
```

Record the exact file:line for each. If any turns out to be far from where a notification helper belongs (e.g. buried in a deep transaction), extract a small helper `afterTransactionInserted(userId, tx)` that lives in `backend/src/domain/notifications/hooks.ts` and call it once from each insertion path.

- [ ] **Step 3: Implement `envelope-check.ts` first (so `hooks.ts` can import it)**

`backend/src/domain/notifications/envelope-check.ts`: read current month's spend for `categoryId` from the existing `category_budgets` + transactions aggregate query used by the Budget page (grep `budgets.ts` in `backend/src/http/routes/` for the reference query). Export a single function:

```ts
export async function computeEnvelope(
  userId: number,
  categoryId: number,
): Promise<{ spent: number; envelope: number | null; month: string }>;
```

Return `{ spent, envelope, month }` where `month` is `YYYY-MM` for today.

- [ ] **Step 4: Implement `hooks.ts`**

`backend/src/domain/notifications/hooks.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userSettings, accounts } from '../../db/schema.js';
import { mergeSettings } from '../settings/schema.js';
import { emitNotification } from './emit.js';
import { queueBatched, flushBatch } from './batcher.js';
import { computeEnvelope } from './envelope-check.js';

async function loadPrefs(userId: number) {
  const [row] = await db.select({ settings: userSettings.settings })
    .from(userSettings).where(eq(userSettings.userId, userId));
  return mergeSettings(row?.settings ?? {}).notifications;
}

export async function afterTransactionInserted(userId: number, tx: {
  id: number; accountId: number; amount: number; merchant: string | null; categoryId: number | null;
  newBalance: number;
}): Promise<void> {
  const prefs = await loadPrefs(userId);

  // big_transaction
  const threshold = prefs.triggers.bigTransaction.thresholds[String(tx.accountId)];
  if (prefs.triggers.bigTransaction.enabled && threshold != null && Math.abs(tx.amount) >= threshold) {
    queueBatched(userId, `bt:${tx.accountId}`, { accountId: tx.accountId, amount: Math.abs(tx.amount) });
  }

  // account_low
  const floor = prefs.triggers.accountLow.floors[String(tx.accountId)];
  if (prefs.triggers.accountLow.enabled && floor != null && tx.newBalance < floor) {
    const today = new Date().toISOString().slice(0, 10);
    await emitNotification(userId, 'account_low',
      { kind: 'account_low', accountId: tx.accountId, balance: tx.newBalance, floor },
      { idempotency: `low:${tx.accountId}:${today}` });
  }

  // envelope_exceeded — read current month's envelope spent for tx.categoryId
  if (prefs.triggers.envelopeExceeded.enabled && tx.categoryId != null) {
    // small helper in envelope-check.ts — see next file
    const { spent, envelope, month } = await computeEnvelope(userId, tx.categoryId);
    if (envelope != null && spent > envelope) {
      await emitNotification(userId, 'envelope_exceeded',
        { kind: 'envelope_exceeded', categoryId: tx.categoryId, envelope, spent, month },
        { idempotency: `env:${tx.categoryId}:${month}` });
    }
  }
}

export async function afterBankSyncCompleted(userId: number, accountId: number, ok: boolean, reason?: string): Promise<void> {
  const prefs = await loadPrefs(userId);
  const today = new Date().toISOString().slice(0, 10);
  if (!ok && prefs.triggers.bankSyncFailed.enabled) {
    await emitNotification(userId, 'bank_sync_failed',
      { kind: 'bank_sync_failed', accountId, reason: reason ?? 'unknown' },
      { idempotency: `sync:${accountId}:${today}` });
  }
  // At end of sync, force-flush any accumulated big_transaction batches for accounts in this sync.
  await flushBatch(userId, `bt:${accountId}`);
}
```

- [ ] **Step 5: Wire the call sites**

- In each transaction-insert path (route + `commitImport.ts`): after the insert, recompute the new balance and call `afterTransactionInserted(userId, tx)`.
- In the bank-sync finalize path: call `afterBankSyncCompleted(userId, accountId, ok, reason)`.

- [ ] **Step 6: Run to green**

```
cd backend && RUN_DB_TESTS=1 npx vitest run notifications-triggers
```

- [ ] **Step 7: Commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add backend/src/domain/notifications/hooks.ts backend/src/domain/notifications/envelope-check.ts \
      backend/src/domain/imports/commitImport.ts backend/src/http/routes/transactions/ \
      backend/src/domain/bank-sync/ backend/tests/notifications-triggers.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(notifications): wire big_tx / account_low / envelope / sync-fail triggers"
```

---

### Task 9: Frontend stream client + react-query hooks

**Files:**
- Create: `frontend/src/lib/notifications/stream.ts`
- Create: `frontend/src/lib/notifications/hooks.ts`
- Modify: `frontend/src/App.tsx` (mount the stream client behind auth)
- Test: `frontend/src/lib/notifications/__tests__/stream.test.ts`

**Interfaces:**
- Consumes: `Notification` from `shared/api-contracts.ts`.
- Produces:
  - `startNotificationsStream(onEvent: (n: Notification) => void): () => void`
  - `useNotificationInbox({ unread?: boolean })`, `useUnreadCount()`, `useMarkRead()`, `useMarkAllRead()`, `useDeleteNotification()`, `useTestNotification()`.

- [ ] **Step 1: Write the failing stream test**

`frontend/src/lib/notifications/__tests__/stream.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { startNotificationsStream } from '../stream.js';

class FakeES {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { (FakeES.instance = this); }
  static instance: FakeES | null = null;
}

describe('stream', () => {
  it('parses events and calls onEvent', () => {
    (globalThis as any).EventSource = FakeES;
    const cb = vi.fn();
    const stop = startNotificationsStream(cb);
    FakeES.instance!.onmessage!({ data: JSON.stringify({ id: 1, kind: 'test', title: 'T', body: 'B', payload: { kind: 'test' }, readAt: null, createdAt: '2026-09-01T00:00:00Z' }) } as any);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: 1, kind: 'test' }));
    stop();
    expect(FakeES.instance!.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and confirm fail**

- [ ] **Step 3: Implement `stream.ts`**

```ts
import type { Notification } from '../../../../shared/api-contracts.js';

export function startNotificationsStream(onEvent: (n: Notification) => void): () => void {
  const es = new EventSource('/api/notifications/stream', { withCredentials: true });
  es.onmessage = (ev) => {
    try { onEvent(JSON.parse(ev.data)); } catch { /* ignore malformed frame */ }
  };
  return () => es.close();
}
```

- [ ] **Step 4: Implement `hooks.ts`**

React-query wrappers around each of the six HTTP endpoints. Key style follows the existing codebase — grep `useQuery.*api/` under `frontend/src` to match. Example (repeat this shape for the other five):

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Notification } from '../../../../shared/api-contracts.js';

export function useNotificationInbox(params: { unread?: boolean; kind?: string } = {}) {
  return useQuery({
    queryKey: ['notifications', 'inbox', params],
    queryFn: async (): Promise<{ items: Notification[]; nextCursor: number | null }> => {
      const q = new URLSearchParams();
      if (params.unread) q.set('unread', '1');
      if (params.kind)   q.set('kind', params.kind);
      const r = await fetch(`/api/notifications?${q}`, { credentials: 'include' });
      if (!r.ok) throw new Error('list failed');
      return r.json();
    },
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/notifications/${id}/read`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error('mark-read failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
```

Also add `useUnreadCount`, `useMarkAllRead`, `useDeleteNotification`, `useTestNotification` following the same pattern. On any stream event (from Step 5), call `queryClient.invalidateQueries({ queryKey: ['notifications'] })`.

- [ ] **Step 5: Mount in `App.tsx`**

Inside the authenticated tree, add:

```tsx
useEffect(() => {
  if (!isAuthenticated) return;
  const stop = startNotificationsStream((n) => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    fanoutToChannels(n); // wired in Tasks 10–12
  });
  return stop;
}, [isAuthenticated, queryClient]);
```

`fanoutToChannels` is a stub in this task — it becomes real in Task 10.

- [ ] **Step 6: Run to green**

```
cd frontend && npx vitest run src/lib/notifications
```

- [ ] **Step 7: Commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  add frontend/src/lib/notifications/ frontend/src/App.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -m "feat(notifications/ui): SSE stream client + react-query hooks"
```

---

### Task 10: Toast channel adapter + Toast component (if missing)

**Files:**
- Grep first: `grep -Rn "toast" frontend/src/components frontend/src/lib` — if a primitive exists, use it. If not, create `frontend/src/components/Toast.tsx`.
- Create: `frontend/src/lib/notifications/channels/toast.ts`
- Modify: `frontend/src/lib/notifications/stream.ts` (wire fanout)
- Test: `frontend/src/lib/notifications/__tests__/channels-toast.test.tsx`

**Interfaces:**
- Consumes: pref hook `useNotificationPrefs()` (added later — for now, read via `localStorage` fallback OR pass prefs into the fanout at wire time from `App.tsx`).
- Produces: `showToast(n: Notification, prefs): void`.

- [ ] **Step 1: Write the failing test**

Render a `<ToastHost />` in a test host, call `showToast(...)`, assert the toast is in the DOM, wait fake-timers for auto-dismiss, assert it's gone.

- [ ] **Step 2: Implement**

If no primitive exists, add a minimal React-context toast host in `frontend/src/components/Toast.tsx` (max 150 lines):

```tsx
import { createContext, useContext, useState, useCallback, useEffect } from 'react';

type ToastItem = { id: number; title: string; body: string };
const Ctx = createContext<{ push: (t: Omit<ToastItem, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="rounded-lg bg-slate-800 text-white p-3 shadow-lg max-w-sm">
            <div className="font-medium">{t.title}</div>
            <div className="text-sm opacity-90">{t.body}</div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast requires <ToastProvider>');
  return ctx;
}
```

Mount `<ToastProvider>` inside the auth'd tree in `App.tsx` (above the router).

Adapter `frontend/src/lib/notifications/channels/toast.ts` — one function that receives a `push` callback (obtained by callers via `useToast()`), so the channel adapter stays hook-free:

```ts
import type { Notification } from '../../../../../shared/api-contracts.js';

export function showToast(push: (t: { title: string; body: string }) => void, n: Notification): void {
  push({ title: n.title, body: n.body });
}
```

- [ ] **Step 3: Run to green**

- [ ] **Step 4: Commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -am "feat(notifications/ui): toast channel adapter (+ toast host)"
```

---

### Task 11: OS Native adapter (Tauri)

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml` — add `tauri-plugin-notification = "2"`
- Modify: `desktop/src-tauri/src/lib.rs` — register plugin
- Modify: `desktop/src-tauri/capabilities/default.json` — grant `notification:default`
- Create: `frontend/src/lib/notifications/channels/osNative.ts`
- Test: `frontend/src/lib/notifications/__tests__/channels-osNative.test.ts`

**Interfaces:**
- Consumes: `Notification` from Task 1; `window.__TAURI__` presence check.
- Produces: `sendOsNotification(n: Notification, prefs): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Mock `@tauri-apps/plugin-notification`'s `sendNotification`. Assert:
- Skipped when `window.__TAURI__` is `undefined`.
- Called with `title` + redacted `body` (uses payload-driven redaction stringifier; when `hideAmount`, no currency string in body).

- [ ] **Step 2: Add Rust plugin**

Edit `Cargo.toml` + `default.json` + `lib.rs`. Match the pattern in the existing plugins list (grep for `Builder::default()` in `lib.rs`).

- [ ] **Step 3: Implement adapter**

```ts
import type { Notification } from '../../../../../shared/api-contracts.js';
import { renderBody, renderTitle } from '../render-client.js'; // client-side mirror of backend render

export async function sendOsNotification(n: Notification, prefs: { hideAmount: boolean; hideMerchant: boolean }): Promise<void> {
  if (!(globalThis as any).window?.__TAURI__) return;
  const { sendNotification, isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
  if (!(await isPermissionGranted()) && (await requestPermission()) !== 'granted') return;
  await sendNotification({
    title: renderTitle(n.payload, prefs),
    body: renderBody(n.payload, prefs),
  });
}
```

Copy the render module's logic to a client-side `render-client.ts` — pure functions, no DB deps. Small; expected under 60 lines. This is duplication by design: server-render for stream payload's `title/body`; client-render again for OS/browser with the redaction flags the user chose.

- [ ] **Step 4: Run to green**

- [ ] **Step 5: Commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -am "feat(notifications/desktop): Tauri OS notification adapter"
```

---

### Task 12: Web Push adapter

**Files:**
- Create: `frontend/src/lib/notifications/channels/webPush.ts`
- Test: `frontend/src/lib/notifications/__tests__/channels-webPush.test.ts`

**Interfaces:**
- Consumes: browser `Notification` global.
- Produces: `sendWebPush(n: Notification, prefs): void`, `requestWebPushPermission(): Promise<NotificationPermission>`.

- [ ] **Step 1: Failing test**

Mock `Notification` constructor + `Notification.requestPermission`. Assert:
- No-op if `Notification.permission === 'denied'`.
- Fires `new Notification(title, { body, tag })` with redacted strings.
- `requestWebPushPermission` calls the API.

- [ ] **Step 2: Implement**

```ts
import type { Notification as N } from '../../../../../shared/api-contracts.js';
import { renderBody, renderTitle } from '../render-client.js';

export function sendWebPush(n: N, prefs: { hideAmount: boolean; hideMerchant: boolean }): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  new Notification(renderTitle(n.payload, prefs), {
    body: renderBody(n.payload, prefs),
    tag: `athena-${n.id}`,
  });
}

export function requestWebPushPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return Promise.resolve('denied');
  return Notification.requestPermission();
}
```

- [ ] **Step 3: Wire fanout in stream mount**

Replace the `fanoutToChannels` stub in `App.tsx` (Task 9) with:

```ts
const prefs = notificationPrefs.channels;
if (prefs.toast)    showToast(n, notificationPrefs.privacy);
if (prefs.osNative) void sendOsNotification(n, notificationPrefs.privacy);
if (prefs.webPush)  sendWebPush(n, notificationPrefs.privacy);
```

- [ ] **Step 4: Run to green, commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -am "feat(notifications/ui): Web Notifications adapter + fanout wiring"
```

---

### Task 13: NotificationBell component

**Files:**
- Create: `frontend/src/components/NotificationBell.tsx`
- Modify: whichever component mounts the top nav (grep in `frontend/src/App.tsx` and its layout children)
- Test: `frontend/src/components/__tests__/NotificationBell.test.tsx`

**Interfaces:**
- Consumes: `useUnreadCount`, `useNotificationInbox({ unread: true, limit: 10 })`, `useMarkRead`.
- Produces: `<NotificationBell />` — renders a bell icon + badge + popover.

- [ ] **Step 1: Failing test**

Mount with a query client, mock the fetch to return `{ count: 3 }`. Assert badge shows "3". Open popover, click a row, assert `useMarkRead` mutation was called with the row id.

- [ ] **Step 2: Implement**

Small Tailwind popover; keep the file under 250 lines. Use whichever icon library the project already uses (grep imports for `lucide-react` / `@heroicons/react` / similar).

- [ ] **Step 3: Mount in the header**

Wire into the current nav / header component.

- [ ] **Step 4: Run to green, commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -am "feat(notifications/ui): header bell with unread badge + popover"
```

---

### Task 14: Notifications inbox page

**Files:**
- Create: `frontend/src/pages/Notifications/index.tsx`
- Modify: `frontend/src/App.tsx` — add route `/notifications`
- Test: `frontend/src/pages/Notifications/__tests__/index.test.tsx`

**Interfaces:**
- Consumes: inbox hooks, `Notification` type.
- Produces: the `/notifications` route.

- [ ] **Step 1: Failing test**

Assert: empty state renders; rows render grouped by day; filter chips change the query key; "Mark all as read" calls the correct mutation.

- [ ] **Step 2: Implement**

Keep the page under 300 lines by splitting `NotificationsList.tsx` and `NotificationRow.tsx` as siblings if needed.

- [ ] **Step 3: Run to green, commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -am "feat(notifications/ui): inbox page at /notifications"
```

---

### Task 15: SettingsNotifications sub-page

**Files:**
- Create: `frontend/src/pages/Settings/SettingsNotifications.tsx`
- Modify: `frontend/src/pages/Settings/Settings.tsx` — add a "Notifications" tab
- Test: `frontend/src/pages/Settings/__tests__/SettingsNotifications.test.tsx`
- Locale files under `frontend/src/i18n/` (grep the existing structure; add a `notifications` namespace or nested keys).

**Interfaces:**
- Consumes: existing settings PATCH endpoint (grep — likely `/api/settings`), `requestWebPushPermission` from Task 12, `parseDecimal` helper (grep `parseDecimal` under `frontend/src/lib`).
- Produces: the Notifications sub-page.

- [ ] **Step 1: Failing test**

- Master toggle disables all children.
- Per-account threshold input uses `parseDecimal`, not a native number input (assert `type="text"` and `inputMode="decimal"`).
- Enabling "Browser notifications" calls `Notification.requestPermission` exactly once (mock).
- "Send a test" calls `useTestNotification` mutation.

- [ ] **Step 2: Implement**

Keep under 300 lines; extract `NotificationsChannelsCard.tsx`, `NotificationsPrivacyCard.tsx`, `NotificationsTriggersCard.tsx` as siblings if needed.

- [ ] **Step 3: Run to green, commit**

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -am "feat(notifications/ui): Settings → Notifications sub-page"
```

---

### Task 16: E2E happy path + docs

**Files:**
- Create: `frontend/e2e-fullstack/notifications.spec.ts`
- Modify: `docs/users/` — add a short "Notifications" page describing what the four triggers do and how to configure them.
- Modify: `CHANGELOG.md` — one bullet.

**Interfaces:** none (integration only).

- [ ] **Step 1: Write the Playwright test**

Steps in the test:
1. Sign in as the seeded user.
2. Open Settings → Notifications, set `Big transaction` threshold on the demo checking account to `500`.
3. Import a CSV containing a `-800` transaction on that account (reuse existing e2e fixture pattern).
4. Wait for the SSE-driven UI update (poll `useUnreadCount` UI up to 3s).
5. Assert the bell badge shows a count and the inbox page lists a `big_transaction` row.

- [ ] **Step 2: Add user doc**

`docs/users/notifications.md` — one page, four sections (one per trigger), plus a "Privacy mode" section. Cross-link from `docs/users/README.md`.

- [ ] **Step 3: Run E2E locally, commit**

```
cd frontend && npx playwright test -c playwright.fullstack.config.ts notifications
```

Then:

```
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
  commit -am "test(e2e): notification happy path + docs page"
```

---

## Final verification (before push)

- [ ] `cd backend && npx vitest run` — green
- [ ] `cd backend && RUN_DB_TESTS=1 npx vitest run` — green (requires OrbStack Postgres; per project memory, only if the runtime is already up)
- [ ] `cd frontend && npx vitest run` — green
- [ ] `cd frontend && npx eslint . --max-warnings=0` — green (max-lines guard)
- [ ] Manual: enable OS notifications in the desktop app, hit "Send a test", confirm the banner shows the redacted text.
- [ ] Manual: enable Browser notifications in a browser tab, grant permission, hit "Send a test", confirm the notification shows the redacted text.
