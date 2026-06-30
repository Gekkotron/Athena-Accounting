import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { transferRules } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';

const CreateBody = z.object({
  keyword: z.string().trim().min(1).max(256),
  direction: z.enum(['outgoing', 'incoming']),
  counterpartAccountId: z.number().int().positive().optional().nullable(),
  enabled: z.boolean().default(true),
});

const UpdateBody = CreateBody.partial();
const IdParam = z.object({ id: z.coerce.number().int().positive() });

function parseId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = IdParam.safeParse(req.params);
  if (!r.success) {
    reply.code(400).send({ error: 'invalid id' });
    return null;
  }
  return r.data.id;
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string';
}

export async function transferRulesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/transfer-rules', async (req) => {
    const uid = userId(req);
    const rows = await db
      .select()
      .from(transferRules)
      .where(eq(transferRules.userId, uid))
      .orderBy(transferRules.id);
    return { transferRules: rows };
  });

  app.post('/api/transfer-rules', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    try {
      const [created] = await db
        .insert(transferRules)
        .values({ ...parsed.data, userId: uid })
        .returning();
      return reply.code(201).send({ transferRule: created });
    } catch (err) {
      if (isPgError(err) && err.code === '23503') {
        return reply.code(400).send({ error: 'unknown counterpartAccountId' });
      }
      throw err;
    }
  });

  app.put('/api/transfer-rules/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }
    const [updated] = await db
      .update(transferRules)
      .set(parsed.data)
      .where(and(eq(transferRules.id, id), eq(transferRules.userId, uid)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return { transferRule: updated };
  });

  app.delete('/api/transfer-rules/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [deleted] = await db
      .delete(transferRules)
      .where(and(eq(transferRules.id, id), eq(transferRules.userId, uid)))
      .returning({ id: transferRules.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}
