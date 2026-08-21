import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactions } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import {
  MAX_DAY_DELTA,
  MAX_AMOUNT_DELTA,
  LABEL_JACCARD_THRESHOLD,
} from '../../../domain/dedup/fuzzy-match.js';
import { groupMinPairwiseSimilarity } from '../../../lib/label-similarity.js';

type Row = Record<string, unknown> & {
  id: number;
  account_id: number;
  date: string;
  amount: string;
  raw_label: string;
  not_duplicate: boolean;
};

export interface DuplicatesResponse {
  groups: Array<{
    accountId: number;
    date: string;
    amount: string;
    transactions: Row[];
  }>;
}

// Soft-dedup detection: find transactions that share (account, ±date-window,
// ±amount-window, same sign) but have a different dedup_key — labels that
// differ enough to evade the strict UNIQUE constraint but match enough on
// identity to be plausible duplicates worth a human glance. Widened from the
// exact-tuple match so bank re-posts and rounding drift surface too; groups
// are then filtered by max-pairwise Jaccard so a coincidental (date, amount)
// collision with disjoint labels drops out.
export async function getDuplicates(opts: {
  userId: number;
  accountIdFilter?: number | null;
}): Promise<DuplicatesResponse> {
  const accountIdFilter = opts.accountIdFilter ?? null;
  const rows = await db.execute<Row>(sql`
    SELECT t.*
    FROM transactions t
    WHERE t.user_id = ${opts.userId}
      AND t.transfer_group_id IS NULL
      ${accountIdFilter !== null ? sql`AND t.account_id = ${accountIdFilter}` : sql``}
      AND EXISTS (
        SELECT 1 FROM transactions t2
        WHERE t2.user_id = t.user_id
          AND t2.account_id = t.account_id
          AND t2.id <> t.id
          AND t2.transfer_group_id IS NULL
          AND ABS(t2.date - t.date) <= ${MAX_DAY_DELTA}
          AND ABS(t2.amount::numeric - t.amount::numeric) <= ${MAX_AMOUNT_DELTA}
          AND SIGN(t2.amount::numeric) = SIGN(t.amount::numeric)
      )
    ORDER BY t.account_id, t.date DESC, t.amount, t.id
  `);

  const byAccount = new Map<number, Row[]>();
  for (const r of rows.rows) {
    const arr = byAccount.get(r.account_id) ?? [];
    arr.push(r);
    byAccount.set(r.account_id, arr);
  }

  const groups: DuplicatesResponse['groups'] = [];
  for (const [accountId, accountRows] of byAccount) {
    // Connected-components clustering via Union-Find over the fuzzy-adjacency
    // graph. A chain a↔b↔c can group without a↔c matching directly.
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let cur = x;
      while (parent.get(cur) !== cur) {
        const p = parent.get(cur)!;
        parent.set(cur, parent.get(p)!);
        cur = parent.get(cur)!;
      }
      return cur;
    };
    for (const r of accountRows) parent.set(r.id, r.id);
    for (let i = 0; i < accountRows.length; i++) {
      for (let j = i + 1; j < accountRows.length; j++) {
        const a = accountRows[i]!;
        const b = accountRows[j]!;
        const dateDiff = Math.abs(dateToUtc(a.date) - dateToUtc(b.date)) / 86_400_000;
        if (dateDiff > MAX_DAY_DELTA) continue;
        if (Math.abs(Number(a.amount) - Number(b.amount)) > MAX_AMOUNT_DELTA + 1e-9) continue;
        if (Math.sign(Number(a.amount)) !== Math.sign(Number(b.amount))) continue;
        const ra = find(a.id);
        const rb = find(b.id);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
    const byRoot = new Map<number, Row[]>();
    for (const r of accountRows) {
      const root = find(r.id);
      const arr = byRoot.get(root) ?? [];
      arr.push(r);
      byRoot.set(root, arr);
    }
    for (const [, members] of byRoot) {
      if (members.length < 2) continue;
      const labels = members.map((m) => m.raw_label);
      if (groupMinPairwiseSimilarity(labels) < LABEL_JACCARD_THRESHOLD) continue;
      if (members.every((m) => m.not_duplicate)) continue;
      members.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date.localeCompare(b.date)));
      groups.push({
        accountId,
        date: members[0]!.date,
        amount: members[0]!.amount,
        transactions: members,
      });
    }
  }
  return { groups };
}

function dateToUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function registerDuplicateRoutes(app: FastifyInstance): void {
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
    return getDuplicates({ userId: uid, accountIdFilter });
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
