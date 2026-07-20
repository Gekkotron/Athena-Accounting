import type { FastifyReply, FastifyRequest } from 'fastify';
import { inArray } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactionSplits } from '../../../db/schema.js';
import { IdParam } from './schemas.js';

export function isPgError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string';
}

export function parseId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = IdParam.safeParse(req.params);
  if (!r.success) {
    reply.code(400).send({ error: 'invalid id' });
    return null;
  }
  return r.data.id;
}

// Amount-search widening: "19" → [19.00, 19.99] (finds 19.72),
// "55.5" → [55.50, 55.59] (finds 55.57), "19.72" → [19.72, 19.72] (exact).
// Callers combine with a sign-agnostic OR so both credit and debit match.
// The needle may carry a leading `-`, which is stripped by the caller.
export function buildAmountRange(unsignedNeedle: string): { lo: string; hi: string } {
  const [intPart, fracPart = ''] = unsignedNeedle.split('.');
  const missing = 2 - fracPart.length;
  const lo = `${intPart}.${fracPart}${'0'.repeat(missing)}`;
  const hi = `${intPart}.${fracPart}${'9'.repeat(missing)}`;
  return { lo, hi };
}

/**
 * Attach `splits: TransactionSplit[]` to each row. Batched single query on
 * `transaction_splits.transaction_id IN (...)`; empty array when the parent
 * has no splits.
 *
 * INVARIANT: callers MUST filter `rows` by the caller's `userId` before
 * hydration. This helper does NOT re-filter by user_id — it trusts that the
 * incoming `rows` are already scoped to the caller. Adding a new caller that
 * passes unscoped rows would leak splits across users.
 */
export async function hydrateSplits<T extends { id: number }>(rows: T[]): Promise<Array<T & { splits: Array<{
  id: number; transactionId: number; categoryId: number | null; amount: string; memo: string | null;
}> }>> {
  if (rows.length === 0) return rows.map((r) => ({ ...r, splits: [] }));
  const ids = rows.map((r) => r.id);
  const splits = await db
    .select()
    .from(transactionSplits)
    .where(inArray(transactionSplits.transactionId, ids));
  const byTx = new Map<number, Array<typeof splits[number]>>();
  for (const s of splits) {
    const arr = byTx.get(s.transactionId) ?? [];
    arr.push(s);
    byTx.set(s.transactionId, arr);
  }
  return rows.map((r) => ({
    ...r,
    splits: (byTx.get(r.id) ?? []).map((s) => ({
      id: s.id,
      transactionId: s.transactionId,
      categoryId: s.categoryId,
      amount: s.amount,
      memo: s.memo,
    })),
  }));
}
