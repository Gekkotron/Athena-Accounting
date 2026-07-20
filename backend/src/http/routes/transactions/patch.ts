import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactions } from '../../../db/schema.js';
import { normalizeLabel } from '../../../domain/imports/normalize.js';
import { userId } from '../../plugins/auth.js';
import { PatchBody } from './schemas.js';
import { isPgError, parseId } from './helpers.js';

// Inline category edit from the UI. Any explicit categoryId set via this
// endpoint flips category_source to 'manual' — this is the flag the
// retroactive recategorizer respects when `preserveManual: true`.
export function registerPatch(app: FastifyInstance): void {
  app.patch('/api/transactions/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    // Build the actual SET clause from the fields present in the patch.
    // category_source flips to 'manual' only when the categoryId itself is
    // touched — updating just a note shouldn't change provenance.
    // dedup_key stays static so re-imports of the source file still find the
    // row (edits change content, not identity).
    const updates: {
      accountId?: number;
      date?: string;
      amount?: string;
      rawLabel?: string;
      normalizedLabel?: string;
      categoryId?: number | null;
      categorySource?: 'manual';
      notes?: string | null;
      lockYears?: number | null;
    } = {};
    if ('accountId' in parsed.data && parsed.data.accountId !== undefined) {
      updates.accountId = parsed.data.accountId;
    }
    if ('date' in parsed.data && parsed.data.date !== undefined) {
      updates.date = parsed.data.date;
    }
    if ('amount' in parsed.data && parsed.data.amount !== undefined) {
      updates.amount = Number(parsed.data.amount).toFixed(2);
    }
    if ('rawLabel' in parsed.data && parsed.data.rawLabel !== undefined) {
      updates.rawLabel = parsed.data.rawLabel;
      updates.normalizedLabel = normalizeLabel(parsed.data.rawLabel);
    }
    if ('categoryId' in parsed.data) {
      updates.categoryId = parsed.data.categoryId ?? null;
      updates.categorySource = 'manual';
    }
    if ('notes' in parsed.data) {
      const raw = parsed.data.notes;
      updates.notes = raw && raw.trim() ? raw : null;
    }
    if ('lockYears' in parsed.data) {
      updates.lockYears = parsed.data.lockYears ?? null;
    }
    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }

    try {
      const [updated] = await db
        .update(transactions)
        .set(updates)
        .where(and(eq(transactions.id, id), eq(transactions.userId, uid)))
        .returning();
      if (!updated) return reply.code(404).send({ error: 'not found' });
      return { transaction: updated };
    } catch (err) {
      if (isPgError(err) && err.code === '23503') {
        return reply.code(400).send({ error: 'compte ou catégorie inconnu' });
      }
      // Pinned to migration 0014's `transactions_amount_lock_when_split_trg`.
      // If a future migration adds another CHECK/trigger on `transactions`
      // that raises SQLSTATE 23514, that trigger's error should not inherit
      // this specific French message — match on the trigger's own text.
      if (isPgError(err)
          && err.code === '23514'
          && (err as { message?: string }).message?.includes('cannot change transaction amount')) {
        return reply.code(409).send({
          error: "supprimez d'abord la ventilation avant de modifier le montant",
        });
      }
      throw err;
    }
  });
}
