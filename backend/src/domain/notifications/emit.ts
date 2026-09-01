import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, categories, notifications, userSettings } from '../../db/schema.js';
import { mergeSettings } from '../settings/schema.js';
import { renderFullDetail } from './render.js';
import { broadcast } from './bus.js';
import type { Notification, NotificationKind, NotificationPayload } from './types.js';

// Resolves an account/category name for `uid` — undefined if the row is
// gone, cross-tenant, or was never created (the renderer then falls back
// to `#${id}`). Kept per-lookup rather than batched: emitters run one
// notification at a time and the `and(id, userId)` filter uses the
// primary key index.
async function accountNameFor(uid: number, accountId: number): Promise<string | undefined> {
  const [row] = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, uid)));
  return row?.name;
}

async function categoryNameFor(uid: number, categoryId: number): Promise<string | undefined> {
  const [row] = await db
    .select({ name: categories.name })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, uid)));
  return row?.name;
}

// Fills in `accountName` / `categoryName` on the payload so the renderer
// (and every consumer that re-renders the row later — SSE replay, GET
// /api/notifications, frontend inbox — can show the account or category
// as the user knows it. Runs once, at emit-time, before the DB insert,
// so the resolved name is frozen alongside the id. If the caller already
// set the name (see the "Send a test" route), it's kept as-is.
async function enrichPayload(uid: number, payload: NotificationPayload): Promise<NotificationPayload> {
  switch (payload.kind) {
    case 'big_transaction':
      if ('single' in payload) {
        if (payload.single.accountName) return payload;
        return { ...payload, single: { ...payload.single, accountName: await accountNameFor(uid, payload.single.accountId) } };
      }
      if (payload.summary.accountName) return payload;
      return { ...payload, summary: { ...payload.summary, accountName: await accountNameFor(uid, payload.summary.accountId) } };
    case 'account_low':
      if (payload.accountName) return payload;
      return { ...payload, accountName: await accountNameFor(uid, payload.accountId) };
    case 'envelope_exceeded':
      if (payload.categoryName) return payload;
      return { ...payload, categoryName: await categoryNameFor(uid, payload.categoryId) };
    case 'bank_sync_failed':
      if (payload.accountName) return payload;
      return { ...payload, accountName: await accountNameFor(uid, payload.accountId) };
    case 'test':
      return payload;
  }
}

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
  opts: { idempotency?: string; bypassTriggerGate?: boolean } = {},
): Promise<Notification | null> {
  const [row] = await db.select({ settings: userSettings.settings })
    .from(userSettings).where(eq(userSettings.userId, userId));
  const prefs = mergeSettings(row?.settings ?? {}).notifications;
  if (!prefs.enabled) return null;
  const tk = triggerKey(kind);
  if (tk && !opts.bypassTriggerGate && !prefs.triggers[tk].enabled) return null;

  const idempotency = opts.idempotency ?? `${kind}:${Date.now()}:${Math.random()}`;
  const enriched = await enrichPayload(userId, payload);
  const inserted = await db.insert(notifications)
    .values({ userId, kind, payload: enriched, idempotency })
    .onConflictDoNothing({ target: [notifications.userId, notifications.idempotency] })
    .returning();
  if (inserted.length === 0) return null;
  const insertedRow = inserted[0]!;

  const { title, body } = renderFullDetail(enriched);
  const out: Notification = {
    id: insertedRow.id,
    kind,
    payload: enriched,
    title,
    body,
    readAt: null,
    createdAt: insertedRow.createdAt.toISOString(),
  };
  broadcast(userId, { row: out });
  return out;
}
