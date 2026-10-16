import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { loans } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { parseId, isPgError } from '../../../lib/http.js';
import { buildSchedule, type LoanSummary } from '../../../domain/loans/engine/index.js';
import { todayIso, toRecord, toTerms } from '../../../domain/loans/record.js';
import { AsOfQuery, LoanBody, type LoanBodyT } from './schemas.js';

const NAME_TAKEN = { error: 'a loan with this name already exists' };

// Non-enumeration 404: another user's id looks exactly like a missing id.
async function loadOwn(uid: number, id: number) {
  const [row] = await db.select().from(loans).where(and(eq(loans.id, id), eq(loans.userId, uid)));
  return row ?? null;
}

// Parses and engine-checks a create/update body. Sends the 400/404/422
// reply itself and returns null when the request must stop there.
async function readBody(
  uid: number,
  raw: unknown,
  reply: FastifyReply,
  selfId: number | null,
): Promise<{ values: LoanBodyT; summary: LoanSummary } | null> {
  const parsed = LoanBody.safeParse(raw);
  if (!parsed.success) {
    reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    return null;
  }
  const values = parsed.data;
  if (values.sourceLoanId !== null) {
    if (values.sourceLoanId === selfId) {
      reply.code(400).send({ error: 'a loan cannot be its own source' });
      return null;
    }
    if (!(await loadOwn(uid, values.sourceLoanId))) {
      reply.code(404).send({ error: 'not found' });
      return null;
    }
  }
  const res = buildSchedule(toTerms(values), todayIso());
  if (!res.ok) {
    reply.code(422).send({ error: 'invalid loan', errors: res.errors });
    return null;
  }
  return { values, summary: res.summary };
}

export function registerCrud(app: FastifyInstance): void {
  app.post('/api/loans', async (req, reply) => {
    const uid = userId(req);
    const input = await readBody(uid, req.body, reply, null);
    if (!input) return reply;
    try {
      const [row] = await db.insert(loans).values({ userId: uid, ...input.values }).returning();
      if (!row) throw new Error('insert returned no row');
      return reply.code(201).send({ loan: toRecord(row), summary: input.summary });
    } catch (err) {
      if (isPgError(err) && err.code === '23505') return reply.code(409).send(NAME_TAKEN);
      throw err;
    }
  });

  app.get('/api/loans/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const q = AsOfQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid input', issues: q.error.issues });
    const row = await loadOwn(uid, id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    const loan = toRecord(row);
    const res = buildSchedule(toTerms(loan), q.data.asOf ?? todayIso());
    if (!res.ok) return { loan, schedule: [], summary: null, warnings: [], errors: res.errors };
    return { loan, schedule: res.schedule, summary: res.summary, warnings: res.warnings };
  });

  app.put('/api/loans/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    // Ownership first so a cross-user PUT is a 404 even with a bad body.
    if (!(await loadOwn(uid, id))) return reply.code(404).send({ error: 'not found' });
    const input = await readBody(uid, req.body, reply, id);
    if (!input) return reply;
    try {
      const [row] = await db
        .update(loans)
        .set({ ...input.values, updatedAt: new Date() })
        .where(and(eq(loans.id, id), eq(loans.userId, uid)))
        .returning();
      if (!row) return reply.code(404).send({ error: 'not found' });
      return { loan: toRecord(row), summary: input.summary };
    } catch (err) {
      if (isPgError(err) && err.code === '23505') return reply.code(409).send(NAME_TAKEN);
      throw err;
    }
  });

  app.delete('/api/loans/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [deleted] = await db
      .delete(loans)
      .where(and(eq(loans.id, id), eq(loans.userId, uid)))
      .returning({ id: loans.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}
