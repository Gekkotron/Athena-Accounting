import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { categories, transactions, transactionSplits } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { isPgError, parseId } from './helpers.js';

const SplitInput = z.object({
  categoryId: z.number().int().positive(),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
  memo: z.string().max(200).nullable().optional(),
});
const PutBody = z.object({
  splits: z.array(SplitInput).min(2).max(20),
});

// Fixed-point compare via cents. Node's Number is fine for values within
// numeric(14,2)'s range — we only need integer equality after *100 rounding.
function toCents(s: string): number {
  return Math.round(Number(s) * 100);
}

function serialize(row: typeof transactionSplits.$inferSelect) {
  return {
    id: row.id,
    transactionId: row.transactionId,
    categoryId: row.categoryId,
    amount: row.amount,
    memo: row.memo,
  };
}

async function loadOwnedTransaction(uid: number, txId: number) {
  const [row] = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      transferGroupId: transactions.transferGroupId,
    })
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.userId, uid)));
  return row ?? null;
}

export function registerSplitsRoutes(app: FastifyInstance): void {
  app.get('/api/transactions/:id/splits', async (req, reply) => {
    const uid = userId(req);
    const txId = parseId(req, reply);
    if (txId === null) return;
    const parent = await loadOwnedTransaction(uid, txId);
    if (!parent) return reply.code(404).send({ error: 'not found' });
    const rows = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, txId));
    return { splits: rows.map(serialize) };
  });

  app.put('/api/transactions/:id/splits', async (req, reply) => {
    const uid = userId(req);
    const txId = parseId(req, reply);
    if (txId === null) return;
    const parent = await loadOwnedTransaction(uid, txId);
    if (!parent) return reply.code(404).send({ error: 'not found' });

    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const splits = parsed.data.splits;

    if (parent.transferGroupId !== null) {
      return reply.code(400).send({ error: "un virement interne ne peut pas être ventilé" });
    }
    const parentCents = toCents(parent.amount);
    if (parentCents === 0) {
      return reply.code(400).send({ error: 'le montant de la transaction est nul' });
    }

    // Sign guard + non-zero.
    for (const s of splits) {
      const c = toCents(s.amount);
      if (c === 0) {
        return reply.code(400).send({ error: 'chaque ventilation doit avoir un montant non nul' });
      }
      if ((parentCents < 0) !== (c < 0)) {
        return reply.code(400).send({ error: 'le signe de chaque ventilation doit correspondre à celui de la transaction' });
      }
    }

    // Sum guard (belt-and-suspenders with the trigger — friendlier French error).
    const sumCents = splits.reduce((acc, s) => acc + toCents(s.amount), 0);
    if (sumCents !== parentCents) {
      return reply.code(400).send({
        error: 'la somme des ventilations ne correspond pas au montant de la transaction',
      });
    }

    // Category ownership: every categoryId must belong to the caller.
    const wanted = Array.from(new Set(splits.map((s) => s.categoryId)));
    const owned = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, uid)));
    const ownedSet = new Set(owned.map((c) => c.id));
    for (const wid of wanted) {
      if (!ownedSet.has(wid)) {
        return reply.code(400).send({ error: 'catégorie inconnue' });
      }
    }

    try {
      const inserted = await db.transaction(async (tx) => {
        await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, txId));
        const rows = await tx
          .insert(transactionSplits)
          .values(splits.map((s) => ({
            transactionId: txId,
            categoryId: s.categoryId,
            amount: Number(s.amount).toFixed(2),
            memo: s.memo && s.memo.trim() ? s.memo : null,
          })))
          .returning();
        return rows;
      });
      return { splits: inserted.map(serialize) };
    } catch (err) {
      if (isPgError(err) && err.code === '23514') {
        return reply.code(400).send({
          error: 'la somme des ventilations ne correspond pas au montant de la transaction',
        });
      }
      throw err;
    }
  });

  app.delete('/api/transactions/:id/splits', async (req, reply) => {
    const uid = userId(req);
    const txId = parseId(req, reply);
    if (txId === null) return;
    const parent = await loadOwnedTransaction(uid, txId);
    if (!parent) return reply.code(404).send({ error: 'not found' });
    const deleted = await db
      .delete(transactionSplits)
      .where(eq(transactionSplits.transactionId, txId))
      .returning({ id: transactionSplits.id });
    return { deleted: deleted.length };
  });
}
