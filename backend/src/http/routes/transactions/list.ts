import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactions, accounts } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { ListQuery } from './schemas.js';
import { hydrateAttachmentCounts, hydrateSplits, parseId } from './helpers.js';
import { buildListWhere } from './filters.js';
import { computeRunningBalances } from './running-balance.js';

export function registerList(app: FastifyInstance): void {
  app.get('/api/transactions', async (req, reply) => {
    const uid = userId(req);
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const q = parsed.data;

    const where = buildListWhere(uid, q);
    const whereExpr = where.length > 0 ? and(...where) : undefined;
    const dir = q.order === 'asc' ? asc : desc;
    const orderCol =
      q.sort === 'amount' ? transactions.amount :
      q.sort === 'label'  ? transactions.normalizedLabel :
                            transactions.date;

    const rows = await db
      .select()
      .from(transactions)
      .where(whereExpr)
      .orderBy(dir(orderCol), dir(transactions.id))
      .limit(q.limit)
      .offset(q.offset);

    const countRows = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(whereExpr);
    const total = countRows[0]?.total ?? 0;

    // Running balance: only computed when the view is scoped to one account
    // (the only case the UI can display it). We accumulate over the account's
    // history on the SAME basis as `currentBalance` (see accounts.ts /
    // reports.ts): opening_balance + Σ amounts for transactions dated on or
    // after the account's opening_date. Pagination-safe because we key by
    // tx id, so filters and sort never distort a row's value.
    let balanceById: Map<number, string> | null = null;
    if (q.accountId) {
      const [acct] = await db
        .select({ openingBalance: accounts.openingBalance, openingDate: accounts.openingDate })
        .from(accounts)
        .where(and(eq(accounts.id, q.accountId), eq(accounts.userId, uid)));
      if (acct) {
        const history = await db
          .select({ id: transactions.id, amount: transactions.amount })
          .from(transactions)
          .where(and(
            eq(transactions.userId, uid),
            eq(transactions.accountId, q.accountId),
            gte(transactions.date, acct.openingDate),
          ))
          .orderBy(asc(transactions.date), asc(transactions.id));
        balanceById = computeRunningBalances(history, acct.openingBalance);
      }
    }

    const withBalance = balanceById
      ? rows.map((r) => ({ ...r, runningBalance: balanceById!.get(r.id) }))
      : rows;

    const hydrated = await hydrateSplits(withBalance);
    const withCounts = await hydrateAttachmentCounts(hydrated);
    return {
      transactions: withCounts,
      pagination: { total, limit: q.limit, offset: q.offset },
    };
  });

  app.get('/api/transactions/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [row] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, uid)));
    if (!row) return reply.code(404).send({ error: 'not found' });
    const [hydrated] = await hydrateSplits([row]);
    const [withCount] = await hydrateAttachmentCounts([hydrated!]);
    return { transaction: withCount };
  });
}
