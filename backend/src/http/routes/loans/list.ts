import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { loans } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { buildSchedule } from '../../../domain/loans/engine/index.js';
import { todayIso, toRecord, toTerms } from '../../../domain/loans/record.js';
import { AsOfQuery } from './schemas.js';

export function registerList(app: FastifyInstance): void {
  app.get('/api/loans', async (req, reply) => {
    const uid = userId(req);
    const q = AsOfQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid input', issues: q.error.issues });
    const asOf = q.data.asOf ?? todayIso();
    const rows = await db
      .select()
      .from(loans)
      .where(eq(loans.userId, uid))
      .orderBy(asc(loans.createdAt), asc(loans.id));
    return {
      loans: rows.map((row) => {
        const loan = toRecord(row);
        const res = buildSchedule(toTerms(loan), asOf);
        return { ...loan, summary: res.ok ? res.summary : null };
      }),
    };
  });
}
