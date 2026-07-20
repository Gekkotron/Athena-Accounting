import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactions, transactionSplits } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { CategorizeBulkBody } from './schemas.js';
import { isPgError } from './helpers.js';

// Batch-delete a set of transactions by id. Applies the same transfer-leg
// unlink guard as the single-DELETE handler: any mirror leg still owned by
// the user gets its transfer_group_id set to null so aggregates don't
// silently hide it. Wrapped in one DB transaction so a partial failure
// rolls back cleanly.
export function registerBulk(app: FastifyInstance): void {
  app.post('/api/transactions/delete-bulk', async (req, reply) => {
    const uid = userId(req);
    const parsed = z.object({
      ids: z.array(z.number().int().positive()).min(1).max(500),
    }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'ids must be a non-empty array of positive integers (max 500)' });
    }
    const ids = parsed.data.ids;

    const result = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: transactions.id, transferGroupId: transactions.transferGroupId })
        .from(transactions)
        .where(and(eq(transactions.userId, uid), inArray(transactions.id, ids)));

      // Collect transfer-group ids that need mirror unlinking. Only unlink
      // the OTHER leg of the group (not the row we're about to delete). If
      // both legs are in the delete set, the group vanishes entirely — the
      // unlink is a no-op but harmless.
      const groupIds = new Set<string>();
      for (const row of existing) {
        if (row.transferGroupId) groupIds.add(row.transferGroupId);
      }
      if (groupIds.size > 0) {
        await tx
          .update(transactions)
          .set({ transferGroupId: null })
          .where(and(
            eq(transactions.userId, uid),
            inArray(transactions.transferGroupId, Array.from(groupIds)),
          ));
      }

      const deleted = await tx
        .delete(transactions)
        .where(and(eq(transactions.userId, uid), inArray(transactions.id, ids)))
        .returning({ id: transactions.id });
      return { deleted: deleted.length };
    });

    return result;
  });

  // Batch-update the category_id of a set of transactions in one round-trip.
  // Rows that belong to an internal transfer group or that are the parent of
  // a split ventilation are silently partitioned into `skipped` — the client
  // shows a small notice explaining why. Wrapped in one DB transaction so a
  // partial FK failure rolls back cleanly.
  app.post('/api/transactions/categorize-bulk', async (req, reply) => {
    const uid = userId(req);
    const parsed = CategorizeBulkBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { ids, categoryId } = parsed.data;

    try {
      const result = await db.transaction(async (tx) => {
        const owned = await tx
          .select({ id: transactions.id, transferGroupId: transactions.transferGroupId })
          .from(transactions)
          .where(and(eq(transactions.userId, uid), inArray(transactions.id, ids)));

        // A row is a split parent iff at least one transaction_splits row
        // points at it. Query only the ids we already own so we don't leak
        // presence across users.
        const ownedIds = owned.map((r) => r.id);
        const splitParents = ownedIds.length === 0
          ? []
          : await tx
            .select({ id: transactionSplits.transactionId })
            .from(transactionSplits)
            .where(inArray(transactionSplits.transactionId, ownedIds));
        const splitParentSet = new Set(splitParents.map((r) => r.id));

        const eligibleIds = owned
          .filter((r) => r.transferGroupId == null && !splitParentSet.has(r.id))
          .map((r) => r.id);

        if (eligibleIds.length > 0) {
          await tx
            .update(transactions)
            .set({ categoryId, categorySource: 'manual' })
            .where(and(eq(transactions.userId, uid), inArray(transactions.id, eligibleIds)));
        }
        return { updated: eligibleIds.length, skipped: ids.length - eligibleIds.length };
      });
      return result;
    } catch (err) {
      if (isPgError(err) && err.code === '23503') {
        return reply.code(400).send({ error: 'catégorie inconnue' });
      }
      throw err;
    }
  });
}
