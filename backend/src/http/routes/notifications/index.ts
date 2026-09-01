import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { notifications } from '../../../db/schema.js';
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
    const row = await emitNotification(userId(req), 'test', { kind: 'test' },
      { idempotency: `test:${Date.now()}` });
    return reply.code(201).send(row);
  });
}
