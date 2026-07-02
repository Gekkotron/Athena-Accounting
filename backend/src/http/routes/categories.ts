import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { categories } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';

const kindEnum = z.enum(['expense', 'income', 'neutral']);

const CreateBody = z.object({
  name: z.string().trim().min(1).max(64),
  kind: kindEnum,
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'color must be #RRGGBB or #RRGGBBAA')
    .optional()
    .nullable(),
  parentId: z.number().int().positive().optional().nullable(),
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

export async function categoriesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/categories', async (req) => {
    const uid = userId(req);
    const rows = await db
      .select()
      .from(categories)
      .where(eq(categories.userId, uid))
      .orderBy(categories.kind, categories.name);
    return { categories: rows };
  });

  app.post('/api/categories', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    try {
      const [created] = await db.insert(categories).values({ ...parsed.data, userId: uid }).returning();
      return reply.code(201).send({ category: created });
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'category name already exists' });
      }
      throw err;
    }
  });

  app.put('/api/categories/:id', async (req, reply) => {
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
    try {
      const [updated] = await db
        .update(categories)
        .set(parsed.data)
        .where(and(eq(categories.id, id), eq(categories.userId, uid)))
        .returning();
      if (!updated) return reply.code(404).send({ error: 'not found' });
      return { category: updated };
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'category name already exists' });
      }
      throw err;
    }
  });

  app.delete('/api/categories/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [row] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, uid)));
    if (!row) return reply.code(404).send({ error: 'not found' });
    if (row.isDefault) {
      return reply.code(409).send({ error: 'cannot delete the default category' });
    }
    await db
      .delete(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, uid), eq(categories.isDefault, false)));
    return { ok: true };
  });
}
