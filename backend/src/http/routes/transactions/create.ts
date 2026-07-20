import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactions } from '../../../db/schema.js';
import { normalizeLabel } from '../../../domain/imports/normalize.js';
import { computeDedupKey } from '../../../domain/imports/dedup.js';
import { categorizeOne, loadRuleEngine } from '../../../domain/rules/recategorize.js';
import { userId } from '../../plugins/auth.js';
import { CreateBody } from './schemas.js';
import { isPgError } from './helpers.js';

// Manual transaction creation. Same dedup discipline as the importer — the
// UNIQUE(account_id, dedup_key) constraint rejects exact duplicates at the
// DB level, which we translate to a clean 409.
export function registerCreate(app: FastifyInstance): void {
  app.post('/api/transactions', async (req, reply) => {
    const uid = userId(req);
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const v = parsed.data;
    const amount = Number(v.amount).toFixed(2);
    const normalized = normalizeLabel(v.rawLabel);
    const dedupKey = computeDedupKey({
      accountId: v.accountId,
      date: v.date,
      amount,
      normalizedLabel: normalized,
      fitid: null,
    });

    try {
      const [inserted] = await db
        .insert(transactions)
        .values({
          userId: uid,
          accountId: v.accountId,
          date: v.date,
          amount,
          rawLabel: v.rawLabel,
          normalizedLabel: normalized,
          memo: null,
          notes: v.notes && v.notes.trim() ? v.notes : null,
          fitid: null,
          dedupKey,
          categoryId: v.categoryId ?? null,
          categorySource: v.categoryId ? 'manual' : 'auto',
          sourceFileId: null,
          lockYears: v.lockYears ?? null,
        })
        .returning();
      if (!inserted) {
        return reply.code(500).send({ error: 'failed to insert transaction' });
      }

      // If the user didn't pick a category, run the same rule engine the
      // importer runs — keeps semantics consistent across creation paths.
      if (!v.categoryId) {
        const { compiled, defaultId } = await loadRuleEngine(userId(req));
        await categorizeOne(compiled, defaultId, inserted.id, Number(amount), normalized);
      }

      const [final] = await db.select().from(transactions).where(eq(transactions.id, inserted.id));
      return reply.code(201).send({ transaction: final ?? inserted });
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        return reply.code(409).send({
          error: 'une transaction identique existe déjà pour ce compte (même date, montant et libellé)',
        });
      }
      if (isPgError(err) && err.code === '23503') {
        return reply.code(400).send({ error: 'compte ou catégorie inconnu' });
      }
      throw err;
    }
  });
}
