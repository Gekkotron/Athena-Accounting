import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userSettings } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { TIP_IDS } from './tip-ids.js';

const idBody = z.object({ id: z.enum(TIP_IDS) });

export async function tipsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/tips/dismissed', async (req) => {
    const uid = userId(req);
    const [row] = await db
      .select({ dismissedTips: userSettings.dismissedTips })
      .from(userSettings)
      .where(eq(userSettings.userId, uid));
    return { dismissed: row?.dismissedTips ?? {} };
  });

  app.post('/api/tips/dismiss', async (req, reply) => {
    const parsed = idBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'unknown_tip_id' });
    const uid = userId(req);
    const id = parsed.data.id;
    const now = new Date().toISOString();
    // Upsert so this works even if user_settings has no row yet.
    await db
      .insert(userSettings)
      .values({ userId: uid, dismissedTips: { [id]: now } })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          dismissedTips: sql`${userSettings.dismissedTips} || ${JSON.stringify({ [id]: now })}::jsonb`,
          updatedAt: new Date(),
        },
      });
    return reply.code(204).send();
  });

  app.post('/api/tips/undismiss', async (req, reply) => {
    const parsed = idBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'unknown_tip_id' });
    const uid = userId(req);
    await db
      .update(userSettings)
      .set({
        dismissedTips: sql`${userSettings.dismissedTips} - ${parsed.data.id}::text`,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, uid));
    return reply.code(204).send();
  });

  app.post('/api/tips/reset', async (req, reply) => {
    const uid = userId(req);
    await db
      .update(userSettings)
      .set({ dismissedTips: {}, updatedAt: new Date() })
      .where(eq(userSettings.userId, uid));
    return reply.code(204).send();
  });
}
