import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { notifications, userSettings } from '../../db/schema.js';
import { mergeSettings } from '../settings/schema.js';
import { renderFullDetail } from './render.js';
import { broadcast } from './bus.js';
import type { Notification, NotificationKind, NotificationPayload } from './types.js';

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
  const insertedRow = inserted[0]!;

  const { title, body } = renderFullDetail(payload);
  const out: Notification = {
    id: insertedRow.id,
    kind,
    payload,
    title,
    body,
    readAt: null,
    createdAt: insertedRow.createdAt.toISOString(),
  };
  broadcast(userId, { row: out });
  return out;
}
