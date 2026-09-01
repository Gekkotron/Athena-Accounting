import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { accounts, categories, notifications } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { emitNotification } from '../../../domain/notifications/emit.js';
import { renderFullDetail } from '../../../domain/notifications/render.js';
import type { Notification, NotificationPayload } from '../../../domain/notifications/types.js';

const listQuery = z.object({
  unread: z.enum(['1']).optional(),
  kind: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().optional(),
});

const testBody = z.object({
  kind: z.enum(['big_transaction', 'account_low', 'envelope_exceeded', 'bank_sync_failed']).optional(),
}).default({});

// Canned payloads for the "Send a test" button. Fake but plausible so the
// user can see what each trigger looks like without waiting for a real event.
// A test bypasses the per-trigger gate: seeing a preview shouldn't require
// enabling the trigger first — the master toggle still gates.
//
// Resolves the user's first real account and category so the preview reads
// "on Compte Courant at Amazon" instead of "on account #0 at Amazon". If
// the user has no account/category yet (fresh onboarding), fall back to a
// plausible placeholder name — never leave `#0` in the rendered body.
async function sampleTestPayload(
  uid: number,
  kind: NonNullable<z.infer<typeof testBody>['kind']>,
): Promise<NotificationPayload> {
  const [firstAccount] = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.userId, uid))
    .orderBy(accounts.displayOrder, accounts.id)
    .limit(1);
  const [firstCategory] = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.userId, uid))
    .orderBy(categories.id)
    .limit(1);
  const acct = firstAccount ?? { id: 0, name: 'your account' };
  const cat  = firstCategory ?? { id: 0, name: 'your category' };
  switch (kind) {
    case 'big_transaction':
      return { kind, single: { txId: 0, accountId: acct.id, accountName: acct.name, amount: 249.99, merchant: 'Amazon' } };
    case 'account_low':
      return { kind, accountId: acct.id, accountName: acct.name, balance: 42.5, floor: 100 };
    case 'envelope_exceeded': {
      const now = new Date();
      const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      return { kind, categoryId: cat.id, categoryName: cat.name, envelope: 200, spent: 227.3, month };
    }
    case 'bank_sync_failed':
      return { kind, accountId: acct.id, accountName: acct.name, reason: 'test_preview' };
  }
}

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
    const nextCursor = rows.length > q.limit ? items[items.length - 1]!.id : null;
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
    const parsed = testBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' });
    const { kind } = parsed.data;
    const uid = userId(req);
    const row = kind
      ? await emitNotification(uid, kind, await sampleTestPayload(uid, kind),
          { idempotency: `test:${kind}:${Date.now()}`, bypassTriggerGate: true })
      : await emitNotification(uid, 'test', { kind: 'test' },
          { idempotency: `test:${Date.now()}` });
    if (row === null) return reply.code(422).send({ error: 'notifications_disabled' });
    return reply.code(201).send(row);
  });
}
