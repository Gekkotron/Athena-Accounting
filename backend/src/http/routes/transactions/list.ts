import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { transactions, transactionSplits, accounts } from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { ListQuery } from './schemas.js';
import { buildAmountRange, hydrateSplits, parseId } from './helpers.js';
import { computeRunningBalances } from './running-balance.js';

export function registerList(app: FastifyInstance): void {
  app.get('/api/transactions', async (req, reply) => {
    const uid = userId(req);
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const q = parsed.data;

    const where: SQL[] = [eq(transactions.userId, uid)];
    if (q.accountId) where.push(eq(transactions.accountId, q.accountId));
    if (q.categoryId) {
      // Match plain-category transactions OR transactions with any split
      // targeting the wanted category. Keeps the "Livres" filter honest
      // when a Livres split lives on an Amazon transaction whose own
      // category_id points elsewhere (or is null).
      where.push(sql`(
        ${transactions.categoryId} = ${q.categoryId}
        OR EXISTS (
          SELECT 1 FROM ${transactionSplits} s
           WHERE s.transaction_id = ${transactions.id}
             AND s.category_id = ${q.categoryId}
        )
      )`);
    }
    if (q.sourceFileId) where.push(eq(transactions.sourceFileId, q.sourceFileId));
    if (q.fromDate) where.push(gte(transactions.date, q.fromDate));
    if (q.toDate) where.push(lte(transactions.date, q.toDate));
    if (q.minAmount) where.push(gte(transactions.amount, q.minAmount));
    if (q.maxAmount) where.push(lte(transactions.amount, q.maxAmount));
    if (q.amount) {
      // Sign-agnostic match — both the credit and the debit — which is what
      // the user usually means by "find 338€". Missing decimals widen: "19"
      // → 19.00–19.99 (finds 19.72), "55.5" → 55.50–55.59 (finds 55.57), so
      // the results keep updating while the user is still typing. Typing the
      // full cents ("19.72") collapses to an exact match, which is what
      // reconciliation against a known écart needs.
      const { lo, hi } = buildAmountRange(q.amount.replace(/^-/, ''));
      const cond = or(
        and(gte(transactions.amount, lo), lte(transactions.amount, hi)),
        and(gte(transactions.amount, `-${hi}`), lte(transactions.amount, `-${lo}`)),
      );
      if (cond) where.push(cond);
    }
    if (!q.includeTransfers) where.push(isNull(transactions.transferGroupId));

    if (q.search) {
      // Substring match across every user-facing text field, accent- and
      // case-insensitive. Four seq-scan LIKE branches — acceptable at
      // homelab scale (~<10k rows). If perf hurts, promote to a generated
      // column + GIN trigram index (see TODO.md).
      const needle = sql`immutable_unaccent(lower(${q.search}))`;
      where.push(sql`(
        immutable_unaccent(lower(${transactions.rawLabel})) LIKE '%' || ${needle} || '%'
        OR immutable_unaccent(lower(${transactions.normalizedLabel})) LIKE '%' || ${needle} || '%'
        OR immutable_unaccent(lower(coalesce(${transactions.memo}, ''))) LIKE '%' || ${needle} || '%'
        OR immutable_unaccent(lower(coalesce(${transactions.notes}, ''))) LIKE '%' || ${needle} || '%'
      )`);
    }

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
    return {
      transactions: hydrated,
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
    return { transaction: hydrated };
  });
}
