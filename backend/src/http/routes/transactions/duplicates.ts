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

// Default lookback for the duplicates panel — most bank re-posts and
// rounding-drift dupes happen within the same statement cycle, so a
// year of history covers the practical case while capping the SQL
// self-join at O(recent) rather than O(entire history).
const DEFAULT_WINDOW_MONTHS = 12;
const DEFAULT_GROUP_LIMIT = 100;
const MAX_GROUP_LIMIT = 500;

// Soft-dedup detection: find transactions that share (account, ±date-window,
// ±amount-window, same sign) but have a different dedup_key — labels that
// differ enough to evade the strict UNIQUE constraint but match enough on
// identity to be plausible duplicates worth a human glance. The pair-emit
// step runs in SQL (self-join with the ±3d/±0.02 filter), the JS layer
// only walks the pair list to run Union-Find + max-pairwise-Jaccard —
// dropping the pre-refactor O(N²) all-pairs comparison that dominated the
// endpoint on users with a large history.
export async function getDuplicates(opts: {
  userId: number;
  accountIdFilter?: number | null;
  windowMonths?: number;
  limit?: number;
}): Promise<DuplicatesResponse> {
  const accountIdFilter = opts.accountIdFilter ?? null;
  const windowMonths = opts.windowMonths ?? DEFAULT_WINDOW_MONTHS;
  const limit = Math.min(opts.limit ?? DEFAULT_GROUP_LIMIT, MAX_GROUP_LIMIT);

  // Window boundary — computed against real "today" so a long-running
  // process doesn't drift. YYYY-MM-DD form matches the DATE column type.
  const windowStart = new Date();
  windowStart.setUTCMonth(windowStart.getUTCMonth() - windowMonths);
  const windowStartIso = windowStart.toISOString().slice(0, 10);

  // 1. Candidate pairs — SQL self-join emits (id1, id2, account_id) tuples
  //    for rows within the ±3d/±0.02/same-sign envelope. `t2.id > t1.id`
  //    dedupes to one edge per unordered pair. Both legs must fall in the
  //    window; if you want to catch a duplicate of a very old row, widen
  //    the ?window= param.
  const accountFilter1 = accountIdFilter !== null ? sql`AND t1.account_id = ${accountIdFilter}` : sql``;
  const accountFilter2 = accountIdFilter !== null ? sql`AND t2.account_id = ${accountIdFilter}` : sql``;
  const pairs = await db.execute<{ id1: number; id2: number; account_id: number }>(sql`
    SELECT t1.id AS id1, t2.id AS id2, t1.account_id
    FROM transactions t1
    JOIN transactions t2
      ON t2.user_id = t1.user_id
     AND t2.account_id = t1.account_id
     AND t2.transfer_group_id IS NULL
     AND t2.id > t1.id
     AND t2.date >= ${windowStartIso}
     AND ABS(t2.date - t1.date) <= ${MAX_DAY_DELTA}
     AND ABS(t2.amount::numeric - t1.amount::numeric) <= ${MAX_AMOUNT_DELTA}
     AND SIGN(t2.amount::numeric) = SIGN(t1.amount::numeric)
     ${accountFilter2}
    WHERE t1.user_id = ${opts.userId}
      AND t1.transfer_group_id IS NULL
      AND t1.date >= ${windowStartIso}
      ${accountFilter1}
  `);
  if (pairs.rows.length === 0) return { groups: [] };

  // 2. Metadata for every id that shows up in any pair — narrowed to the
  //    six fields the UI actually consumes, one query for the whole set.
  const ids = new Set<number>();
  for (const p of pairs.rows) { ids.add(p.id1); ids.add(p.id2); }
  const rowMeta = await db.execute<Row>(sql`
    SELECT id, account_id, date, amount, raw_label, not_duplicate
    FROM transactions
    WHERE user_id = ${opts.userId}
      AND id IN (${sql.join(Array.from(ids), sql`, `)})
  `);
  const rowById = new Map<number, Row>(rowMeta.rows.map((r) => [r.id, r]));

  // 3. Union-Find over the pair set — O(pairs · α(N)) instead of the
  //    pre-refactor O(rows²) per-account nested loop.
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
  for (const id of ids) parent.set(id, id);
  const pairsByAccount = new Map<number, Array<[number, number]>>();
  for (const p of pairs.rows) {
    const arr = pairsByAccount.get(p.account_id) ?? [];
    arr.push([p.id1, p.id2]);
    pairsByAccount.set(p.account_id, arr);
    const ra = find(p.id1);
    const rb = find(p.id2);
    if (ra !== rb) parent.set(ra, rb);
  }

  // 4. Group by component root, filter by min-pairwise Jaccard, drop
  //    groups where every member is already marked notDuplicate, sort.
  const byRoot = new Map<number, Row[]>();
  for (const id of ids) {
    const root = find(id);
    const row = rowById.get(id);
    if (!row) continue;
    const arr = byRoot.get(root) ?? [];
    arr.push(row);
    byRoot.set(root, arr);
  }
  const groups: DuplicatesResponse['groups'] = [];
  for (const [, members] of byRoot) {
    if (members.length < 2) continue;
    const labels = members.map((m) => m.raw_label);
    if (groupMinPairwiseSimilarity(labels) < LABEL_JACCARD_THRESHOLD) continue;
    if (members.every((m) => m.not_duplicate)) continue;
    members.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date.localeCompare(b.date)));
    groups.push({
      accountId: members[0]!.account_id,
      date: members[0]!.date,
      amount: members[0]!.amount,
      transactions: members,
    });
  }
  // Most-recent groups first, then cap at `limit`.
  groups.sort((a, b) => (b.date === a.date ? 0 : b.date.localeCompare(a.date)));
  return { groups: groups.slice(0, limit) };
}

export function registerDuplicateRoutes(app: FastifyInstance): void {
  app.get('/api/transactions/duplicates', async (req, reply) => {
    const uid = userId(req);
    const q = req.query as { accountId?: string; window?: string; limit?: string };
    let accountIdFilter: number | null = null;
    if (q.accountId) {
      const n = Number(q.accountId);
      if (!Number.isInteger(n) || n <= 0) {
        return reply.code(400).send({ error: 'invalid accountId' });
      }
      accountIdFilter = n;
    }
    let windowMonths: number | undefined;
    if (q.window !== undefined) {
      const n = Number(q.window);
      if (!Number.isInteger(n) || n < 1 || n > 240) {
        return reply.code(400).send({ error: 'window must be an integer between 1 and 240 months' });
      }
      windowMonths = n;
    }
    let limit: number | undefined;
    if (q.limit !== undefined) {
      const n = Number(q.limit);
      if (!Number.isInteger(n) || n < 1) {
        return reply.code(400).send({ error: 'limit must be a positive integer' });
      }
      limit = n;
    }
    return getDuplicates({ userId: uid, accountIdFilter, windowMonths, limit });
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
