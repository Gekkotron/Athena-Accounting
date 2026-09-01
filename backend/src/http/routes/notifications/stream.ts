import type { FastifyInstance } from 'fastify';
import { subscribe } from '../../../domain/notifications/bus.js';
import { userId } from '../../plugins/auth.js';
import { db } from '../../../db/client.js';
import { notifications } from '../../../db/schema.js';
import { and, eq, gt, sql } from 'drizzle-orm';
import { renderFullDetail } from '../../../domain/notifications/render.js';
import type { NotificationPayload } from '../../../domain/notifications/types.js';

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
