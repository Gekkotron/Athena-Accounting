import type { FastifyInstance } from 'fastify';
import { buildSchedule } from '../../../domain/loans/engine/index.js';
import { todayIso, toTerms } from '../../../domain/loans/record.js';
import { AsOfQuery, LoanTermsBody } from './schemas.js';

// Stateless what-if: runs the engine on an unsaved definition. Backs the
// editor's live preview and the what-if panel; never touches the DB.
export function registerSimulate(app: FastifyInstance): void {
  app.post('/api/loans/simulate', async (req, reply) => {
    const q = AsOfQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid input', issues: q.error.issues });
    const parsed = LoanTermsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    const res = buildSchedule(toTerms(parsed.data), q.data.asOf ?? todayIso());
    if (!res.ok) return reply.code(422).send({ error: 'invalid loan', errors: res.errors });
    return { schedule: res.schedule, summary: res.summary, warnings: res.warnings };
  });
}
