import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactions } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';

export function registerDuplicateRoutes(app: FastifyInstance): void {
  // Soft-dedup detection: find transactions that share (account, date, amount)
  // but have a different dedup_key — i.e. labels that differ enough to evade
  // the strict UNIQUE constraint but match enough on identity to be plausible
  // duplicates worth a human glance. Used by the Imports page to surface these
  // after every import.
  app.get('/api/transactions/duplicates', async (req, reply) => {
    const uid = userId(req);
    const q = req.query as { accountId?: string };
    let accountIdFilter: number | null = null;
    if (q.accountId) {
      const n = Number(q.accountId);
      if (!Number.isInteger(n) || n <= 0) {
        return reply.code(400).send({ error: 'invalid accountId' });
      }
      accountIdFilter = n;
    }
    // Surface a group only when at least one of its rows is still unmarked.
    // Once the user clicks "Ce n'est pas un doublon" on every row in the
    // group, BOOL_OR(NOT not_duplicate) flips to false and the group is hidden.
    const rows = await db.execute(sql`
      SELECT t.*
      FROM transactions t
      WHERE t.user_id = ${uid}
        AND (t.account_id, t.date, t.amount) IN (
          SELECT account_id, date, amount
          FROM transactions
          WHERE user_id = ${uid}
          ${accountIdFilter !== null ? sql`AND account_id = ${accountIdFilter}` : sql``}
          GROUP BY account_id, date, amount
          HAVING count(*) >= 2
             AND count(distinct dedup_key) >= 2
             AND BOOL_OR(NOT not_duplicate)
        )
      ${accountIdFilter !== null ? sql`AND t.account_id = ${accountIdFilter}` : sql``}
      ORDER BY t.account_id, t.date DESC, t.amount, t.id
    `);
    const groupsMap = new Map<string, Array<Record<string, unknown>>>();
    for (const r of rows.rows as Array<Record<string, unknown>>) {
      const key = `${r.account_id}|${r.date}|${r.amount}`;
      const arr = groupsMap.get(key) ?? [];
      arr.push(r);
      groupsMap.set(key, arr);
    }
    const groups = Array.from(groupsMap.entries()).map(([k, txns]) => {
      const [accId, date, amount] = k.split('|');
      return {
        accountId: Number(accId),
        date,
        amount,
        transactions: txns,
      };
    });
    return { groups };
  });

  // Batch-mark a set of transaction ids as "not a duplicate". Used by the
  // Possibles doublons panel — clicking the group-level "Ce n'est pas un
  // doublon" button posts every row id in that group at once. Scoped to the
  // calling user so a malicious id list can't flip flags on someone else's
  // rows.
  app.post('/api/transactions/mark-not-duplicate', async (req, reply) => {
    const uid = userId(req);
    const body = req.body as { ids?: unknown };
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
      return reply.code(400).send({ error: 'ids must be a non-empty array of integers' });
    }
    const ids: number[] = [];
    for (const v of body.ids) {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        return reply.code(400).send({ error: 'every id must be a positive integer' });
      }
      ids.push(n);
    }
    const updated = await db
      .update(transactions)
      .set({ notDuplicate: true })
      .where(and(eq(transactions.userId, uid), inArray(transactions.id, ids)))
      .returning({ id: transactions.id });
    return { updated: updated.length };
  });
}
