// Envelope-mode budgeting routes. Independent of /api/budgets — the two
// modes do not share tables. See docs/superpowers/specs/2026-07-16-budget-modes-design.md.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  categories,
  envelopeAssignments,
} from '../../db/schema.js';
import { userId } from '../plugins/auth.js';

const signedDecimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

const monthStr = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM')
  .transform((s) => `${s}-01`);

const currency = z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code');

const IdParam = z.object({ id: z.coerce.number().int().positive() });

function parseId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = IdParam.safeParse(req.params);
  if (!r.success) { reply.code(400).send({ error: 'invalid id' }); return null; }
  return r.data.id;
}

async function expenseCategoryOwned(uid: number, categoryId: number): Promise<boolean> {
  const [row] = await db
    .select({ kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, uid)));
  return !!row && row.kind === 'expense';
}

function serializeAssignment(row: typeof envelopeAssignments.$inferSelect) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    month: row.month.slice(0, 7),          // wire form "YYYY-MM" (DB stores first-of-month DATE)
    amount: row.amount,
    currency: row.currency,
  };
}

export async function envelopesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // ---------- Assignments ----------

  const AsgListQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
  app.get('/api/envelopes/assignments', async (req, reply) => {
    const uid = userId(req);
    const parsed = AsgListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid month' });
    const month = `${parsed.data.month}-01`;
    const rows = await db
      .select()
      .from(envelopeAssignments)
      .where(and(eq(envelopeAssignments.userId, uid), eq(envelopeAssignments.month, month)))
      .orderBy(asc(envelopeAssignments.categoryId));
    return { assignments: rows.map(serializeAssignment) };
  });

  const AsgPutBody = z.object({
    categoryId: z.number().int().positive(),
    month: monthStr,
    amount: signedDecimal,
    currency: currency.optional(),
  });
  app.put('/api/envelopes/assignments', async (req, reply) => {
    const uid = userId(req);
    const parsed = AsgPutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (!(await expenseCategoryOwned(uid, parsed.data.categoryId))) {
      return reply.code(400).send({ error: 'category_not_expense' });
    }
    const [row] = await db
      .insert(envelopeAssignments)
      .values({
        userId: uid,
        categoryId: parsed.data.categoryId,
        month: parsed.data.month,
        amount: parsed.data.amount,
        currency: parsed.data.currency ?? 'EUR',
      })
      .onConflictDoUpdate({
        target: [envelopeAssignments.userId, envelopeAssignments.categoryId, envelopeAssignments.month],
        set: {
          amount: sql`excluded.amount`,
          currency: sql`excluded.currency`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return reply.code(201).send({ assignment: serializeAssignment(row!) });
  });

  app.delete('/api/envelopes/assignments/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [deleted] = await db
      .delete(envelopeAssignments)
      .where(and(eq(envelopeAssignments.id, id), eq(envelopeAssignments.userId, uid)))
      .returning({ id: envelopeAssignments.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // ---------- Reallocate ----------

  const ReallocBody = z.object({
    fromCategoryId: z.number().int().positive(),
    toCategoryId: z.number().int().positive(),
    month: monthStr,
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'must be a positive decimal'),
  });
  app.post('/api/envelopes/reallocate', async (req, reply) => {
    const uid = userId(req);
    const parsed = ReallocBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { fromCategoryId, toCategoryId, month, amount } = parsed.data;
    if (fromCategoryId === toCategoryId) {
      return reply.code(400).send({ error: 'same_category' });
    }
    if (!(await expenseCategoryOwned(uid, fromCategoryId))
      || !(await expenseCategoryOwned(uid, toCategoryId))) {
      return reply.code(400).send({ error: 'category_not_expense' });
    }

    const result = await db.transaction(async (tx) => {
      async function bumpBy(catId: number, delta: string) {
        // Upsert: current amount is unknown; use SQL expression to add.
        const [existing] = await tx
          .select()
          .from(envelopeAssignments)
          .where(and(
            eq(envelopeAssignments.userId, uid),
            eq(envelopeAssignments.categoryId, catId),
            eq(envelopeAssignments.month, month),
          ));
        if (existing) {
          const [updated] = await tx
            .update(envelopeAssignments)
            .set({
              amount: sql`${envelopeAssignments.amount} + ${delta}::numeric`,
              updatedAt: new Date(),
            })
            .where(eq(envelopeAssignments.id, existing.id))
            .returning();
          return updated!;
        }
        const [created] = await tx
          .insert(envelopeAssignments)
          .values({
            userId: uid,
            categoryId: catId,
            month,
            amount: delta,
          })
          .returning();
        return created!;
      }

      const from = await bumpBy(fromCategoryId, `-${amount}`);
      const to = await bumpBy(toCategoryId, amount);
      return { from, to };
    });

    return reply.code(200).send({
      from: serializeAssignment(result.from),
      to:   serializeAssignment(result.to),
    });
  });
}
