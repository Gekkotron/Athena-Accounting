import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { loans } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { parseId } from '../../../lib/http.js';
import { buildSchedule } from '../../../domain/loans/engine/index.js';
import { todayIso, toRecord, toTerms } from '../../../domain/loans/record.js';

// Promote a saved simulation to a real loan. Same row — only is_simulation
// flips to false and source_loan_id is cleared, so the loan's identity,
// name and audit timestamps are preserved.
export function registerConvert(app: FastifyInstance): void {
  app.post('/api/loans/:id/convert', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [current] = await db
      .select()
      .from(loans)
      .where(and(eq(loans.id, id), eq(loans.userId, uid)));
    if (!current) return reply.code(404).send({ error: 'not found' });
    if (!current.isSimulation) return reply.code(400).send({ error: 'loan is not a simulation' });
    const [row] = await db
      .update(loans)
      .set({ isSimulation: false, sourceLoanId: null, updatedAt: new Date() })
      .where(and(eq(loans.id, id), eq(loans.userId, uid)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'not found' });
    const loan = toRecord(row);
    const res = buildSchedule(toTerms(loan), todayIso());
    if (!res.ok) return reply.code(422).send({ error: 'invalid loan', errors: res.errors });
    return { loan, summary: res.summary };
  });
}
