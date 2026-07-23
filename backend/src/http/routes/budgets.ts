import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, categories, categoryBudgets } from '../../db/schema.js';
import { isPgError, parseId } from '../../lib/http.js';
import { userId } from '../plugins/auth.js';

const positiveDecimal = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'must be a positive decimal with up to 2 fraction digits')
  .refine((s) => Number(s) > 0, 'must be greater than 0');

const currency = z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code');
const period = z.enum(['monthly', 'yearly']);

// `accountId` uses `.transform(x => x ?? null)` so both undefined and null hit
// the same null path server-side; the column is nullable and the wire treats
// null as "global (all accounts)".
const accountIdOpt = z.union([z.number().int().positive(), z.null()]).optional();

const CreateBody = z.object({
  categoryId: z.number().int().positive(),
  monthlyLimit: positiveDecimal,
  currency: currency.optional(),
  period: period.optional(),
  accountId: accountIdOpt,
});

const UpdateBody = z.object({
  monthlyLimit: positiveDecimal.optional(),
  currency: currency.optional(),
  period: period.optional(),
  accountId: accountIdOpt,
});

function serialize(row: typeof categoryBudgets.$inferSelect) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    monthlyLimit: row.monthlyLimit,
    currency: row.currency,
    period: row.period,
    accountId: row.accountId,
  };
}

async function expenseCategoryOwned(uid: number, categoryId: number): Promise<boolean> {
  const [row] = await db
    .select({ kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, uid)));
  return !!row && row.kind === 'expense';
}

async function accountOwned(uid: number, accountId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, uid)));
  return !!row;
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
    const accountId = parsed.data.accountId ?? null;
    if (accountId != null && !(await accountOwned(uid, accountId))) {
      return reply.code(400).send({ error: 'account_not_owned' });
    }
    const periodValue = parsed.data.period ?? 'monthly';
    try {
      const [created] = await db
        .insert(categoryBudgets)
        .values({
          userId: uid,
          categoryId: parsed.data.categoryId,
          monthlyLimit: parsed.data.monthlyLimit,
          currency: parsed.data.currency ?? 'EUR',
          period: periodValue,
          accountId,
        })
        .returning();
      return reply.code(201).send({ budget: serialize(created!) });
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({
          error: 'budget_exists',
          categoryId: parsed.data.categoryId,
          period: periodValue,
          accountId,
        });
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
    if (parsed.data.accountId != null && !(await accountOwned(uid, parsed.data.accountId))) {
      return reply.code(400).send({ error: 'account_not_owned' });
    }
    // Read the pre-update row so a 23505 catch below can echo the
    // {categoryId, period, accountId} tuple, matching POST's 409 contract.
    // categoryId never changes via PUT; period/accountId fall back to the
    // existing row's value when the patch didn't touch them.
    const [existing] = await db
      .select({
        categoryId: categoryBudgets.categoryId,
        period: categoryBudgets.period,
        accountId: categoryBudgets.accountId,
      })
      .from(categoryBudgets)
      .where(and(eq(categoryBudgets.id, id), eq(categoryBudgets.userId, uid)));
    if (!existing) return reply.code(404).send({ error: 'not found' });

    const patch: Partial<typeof categoryBudgets.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.monthlyLimit !== undefined) patch.monthlyLimit = parsed.data.monthlyLimit;
    if (parsed.data.currency !== undefined) patch.currency = parsed.data.currency;
    if (parsed.data.period !== undefined) patch.period = parsed.data.period;
    if (parsed.data.accountId !== undefined) patch.accountId = parsed.data.accountId;
    if (Object.keys(patch).length === 1) {
      return reply.code(400).send({ error: 'no fields to update' });
    }
    try {
      const [updated] = await db
        .update(categoryBudgets)
        .set(patch)
        .where(and(eq(categoryBudgets.id, id), eq(categoryBudgets.userId, uid)))
        .returning();
      if (!updated) return reply.code(404).send({ error: 'not found' });
      return { budget: serialize(updated) };
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({
          error: 'budget_exists',
          categoryId: existing.categoryId,
          period: parsed.data.period ?? existing.period,
          accountId: parsed.data.accountId !== undefined ? parsed.data.accountId : existing.accountId,
        });
      }
      throw err;
    }
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
