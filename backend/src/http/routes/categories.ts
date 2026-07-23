import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { categories } from '../../db/schema.js';
import { isPgError, parseId } from '../../lib/http.js';
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
  isInternalTransfer: z.boolean().optional(),
});

const UpdateBody = CreateBody.partial();

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
    let payload = parsed.data;
    if (payload.parentId != null) {
      const [parent] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, payload.parentId), eq(categories.userId, uid)));
      if (!parent) return reply.code(400).send({ error: 'parent not found' });
      if (parent.parentId != null) {
        return reply.code(400).send({ error: 'only 2 levels supported' });
      }
      payload = { ...payload, kind: parent.kind as z.infer<typeof kindEnum> };
    }
    try {
      const [created] = await db.insert(categories).values({ ...payload, userId: uid }).returning();
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

    const [current] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, uid)));
    if (!current) return reply.code(404).send({ error: 'not found' });

    const touchesParent = Object.prototype.hasOwnProperty.call(parsed.data, 'parentId');
    let payload = { ...parsed.data };

    if (touchesParent) {
      const nextParentId = parsed.data.parentId ?? null;
      if (nextParentId !== null) {
        if (nextParentId === id) {
          return reply.code(400).send({ error: 'cannot self-parent' });
        }
        // Does this row already have children? If so, nesting it would create a 3-level chain (or cycle).
        const [child] = await db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.parentId, id), eq(categories.userId, uid)))
          .limit(1);
        if (child) {
          return reply
            .code(400)
            .send({ error: 'cannot nest a category that has children' });
        }
        const [parent] = await db
          .select()
          .from(categories)
          .where(and(eq(categories.id, nextParentId), eq(categories.userId, uid)));
        if (!parent) return reply.code(400).send({ error: 'parent not found' });
        if (parent.parentId != null) {
          return reply.code(400).send({ error: 'only 2 levels supported' });
        }
        payload.kind = parent.kind as z.infer<typeof kindEnum>;
      }
    } else if (parsed.data.kind && current.parentId != null) {
      // Bare kind change on a child. Allowed only if it stays equal to the parent's kind.
      const [parent] = await db
        .select({ kind: categories.kind })
        .from(categories)
        .where(and(eq(categories.id, current.parentId), eq(categories.userId, uid)));
      if (parent && parsed.data.kind !== parent.kind) {
        return reply
          .code(400)
          .send({ error: 'child kind is inherited from parent' });
      }
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(categories)
          .set(payload)
          .where(and(eq(categories.id, id), eq(categories.userId, uid)))
          .returning();
        // If we changed kind on a row that itself has children, cascade to them.
        if (row && payload.kind && current.parentId == null) {
          await tx
            .update(categories)
            .set({ kind: payload.kind })
            .where(
              and(
                eq(categories.userId, uid),
                eq(categories.parentId, id),
                ne(categories.kind, payload.kind),
              ),
            );
        }
        return row;
      });
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
