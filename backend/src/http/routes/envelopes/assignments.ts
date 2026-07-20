import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { envelopeAssignments } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { currency, monthStr, parseId, signedDecimal } from './schemas.js';
import { expenseCategoryOwned } from './helpers.js';
import { serializeAssignment } from './serializers.js';

export function registerAssignmentRoutes(app: FastifyInstance): void {
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
}
