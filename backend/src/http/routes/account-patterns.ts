import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accountFilenamePatterns } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';

const CreateBody = z.object({
  pattern: z.string().trim().min(1).max(256),
  accountId: z.coerce.number().int().positive(),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
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

export async function patternRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/account-filename-patterns', async (req) => {
    const uid = userId(req);
    const rows = await db
      .select()
      .from(accountFilenamePatterns)
      .where(eq(accountFilenamePatterns.userId, uid))
      .orderBy(desc(accountFilenamePatterns.priority));
    return { patterns: rows };
  });

  app.post('/api/account-filename-patterns', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    try {
      const [created] = await db
        .insert(accountFilenamePatterns)
        .values({ ...parsed.data, userId: uid })
        .returning();
      return reply.code(201).send({ pattern: created });
    } catch (err) {
      if (isPgError(err) && err.code === '23503') {
        return reply.code(400).send({ error: 'unknown accountId' });
      }
      throw err;
    }
  });

  app.put('/api/account-filename-patterns/:id', async (req, reply) => {
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
      .update(accountFilenamePatterns)
      .set(parsed.data)
      .where(and(eq(accountFilenamePatterns.id, id), eq(accountFilenamePatterns.userId, uid)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return { pattern: updated };
  });

  app.delete('/api/account-filename-patterns/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [deleted] = await db
      .delete(accountFilenamePatterns)
      .where(and(eq(accountFilenamePatterns.id, id), eq(accountFilenamePatterns.userId, uid)))
      .returning({ id: accountFilenamePatterns.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string';
}
