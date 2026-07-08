import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { categories, categoryBudgets } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';

const positiveDecimal = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'must be a positive decimal with up to 2 fraction digits')
  .refine((s) => Number(s) > 0, 'must be greater than 0');

const currency = z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code');

const CreateBody = z.object({
  categoryId: z.number().int().positive(),
  monthlyLimit: positiveDecimal,
  currency: currency.optional(),
});

const UpdateBody = z.object({
  monthlyLimit: positiveDecimal.optional(),
  currency: currency.optional(),
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

function parseId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = IdParam.safeParse(req.params);
  if (!r.success) {
    reply.code(400).send({ error: 'invalid id' });
    return null;
  }
  return r.data.id;
}

function serialize(row: typeof categoryBudgets.$inferSelect) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    monthlyLimit: row.monthlyLimit,
    currency: row.currency,
  };
}

function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err
    && typeof (err as { code: unknown }).code === 'string';
}

// Confirms the category exists, belongs to the user, and is expense-kind.
async function expenseCategoryOwned(uid: number, categoryId: number): Promise<boolean> {
  const [row] = await db
    .select({ kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, uid)));
  return !!row && row.kind === 'expense';
}

export async function budgetsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/budgets', async (req) => {
    const uid = userId(req);
    const rows = await db
      .select()
      .from(categoryBudgets)
      .where(eq(categoryBudgets.userId, uid))
      .orderBy(asc(categoryBudgets.categoryId));
    return { budgets: rows.map(serialize) };
  });

  app.post('/api/budgets', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (!(await expenseCategoryOwned(uid, parsed.data.categoryId))) {
      return reply.code(400).send({ error: 'category_not_expense' });
    }
    try {
      const [created] = await db
        .insert(categoryBudgets)
        .values({
          userId: uid,
          categoryId: parsed.data.categoryId,
          monthlyLimit: parsed.data.monthlyLimit,
          currency: parsed.data.currency ?? 'EUR',
        })
        .returning();
      return reply.code(201).send({ budget: serialize(created!) });
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({ error: 'budget_exists', categoryId: parsed.data.categoryId });
      }
      throw err;
    }
  });

  app.put('/api/budgets/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const patch: Partial<typeof categoryBudgets.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.monthlyLimit !== undefined) patch.monthlyLimit = parsed.data.monthlyLimit;
    if (parsed.data.currency !== undefined) patch.currency = parsed.data.currency;
    if (Object.keys(patch).length === 1) {
      return reply.code(400).send({ error: 'no fields to update' });
    }
    const [updated] = await db
      .update(categoryBudgets)
      .set(patch)
      .where(and(eq(categoryBudgets.id, id), eq(categoryBudgets.userId, uid)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return { budget: serialize(updated) };
  });

  app.delete('/api/budgets/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [deleted] = await db
      .delete(categoryBudgets)
      .where(and(eq(categoryBudgets.id, id), eq(categoryBudgets.userId, uid)))
      .returning({ id: categoryBudgets.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
