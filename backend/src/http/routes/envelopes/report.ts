import type { FastifyInstance } from 'fastify';
import { and, eq, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import {
  categories,
  envelopeAssignments,
  envelopeCategorySettings,
  envelopeMonthHolds,
  transactions,
} from '../../../db/schema.js';
import { computeCategoryBalances, computePool } from '../../../lib/envelope-math.js';
import { userId } from '../../plugins/auth.js';

export function registerReportRoute(app: FastifyInstance): void {
  const ReportQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

  app.get('/api/envelopes/report', async (req, reply) => {
    const uid = userId(req);
    const parsed = ReportQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid month' });
    const monthYm = parsed.data.month;
    const monthDate = `${monthYm}-01`;

    // 1) Assignments up to & including this month
    const asgnRows = await db
      .select()
      .from(envelopeAssignments)
      .where(and(
        eq(envelopeAssignments.userId, uid),
        lte(envelopeAssignments.month, monthDate),
      ));

    // 2) Spend by (category, month) up to this month for the user's expense
    //    categories. Signed convention: expenses are stored negative, so
    //    spend = -SUM(amount) (matches reports.ts). This lets an occasional
    //    refund (positive amount posted against an expense category) net
    //    against payments in the same category rather than double-counting
    //    as additional spend — needed for one-category tracking of things
    //    like Impôts where a refund arrives once in a while.
    const spendRows = await db
      .select({
        categoryId: transactions.categoryId,
        month: sql<string>`to_char(date_trunc('month', ${transactions.date}), 'YYYY-MM-01')`,
        amount: sql<string>`(-sum(${transactions.amount}))::text`,
      })
      .from(transactions)
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .where(and(
        eq(categories.userId, uid),
        eq(categories.kind, 'expense'),
        eq(transactions.userId, uid),
        lte(transactions.date, sql`(${monthDate}::date + interval '1 month - 1 day')`),
      ))
      .groupBy(transactions.categoryId, sql`date_trunc('month', ${transactions.date})`);

    // 3) Income cumulative up to this month
    const [incomeAgg] = await db
      .select({
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .where(and(
        eq(categories.userId, uid),
        eq(categories.kind, 'income'),
        eq(transactions.userId, uid),
        lte(transactions.date, sql`(${monthDate}::date + interval '1 month - 1 day')`),
      ));

    // 4) Holds: this month + prior month
    const holdRows = await db
      .select()
      .from(envelopeMonthHolds)
      .where(and(
        eq(envelopeMonthHolds.userId, uid),
        sql`${envelopeMonthHolds.month} in (${monthDate}::date, (${monthDate}::date - interval '1 month')::date)`,
      ));
    const holdThis = holdRows.find((h) => String(h.month).slice(0, 10) === monthDate)?.amount ?? '0.00';
    const holdPrev = holdRows.find((h) => String(h.month).slice(0, 10) !== monthDate)?.amount ?? '0.00';

    // 5) Settings (target + policy)
    const settingsRows = await db
      .select()
      .from(envelopeCategorySettings)
      .where(eq(envelopeCategorySettings.userId, uid));
    const settingsBy = new Map(settingsRows.map((s) => [s.categoryId, s]));

    // 6) Category names for the union of {envelope categories, spend categories}
    const catIds = new Set<number>([
      ...asgnRows.map((a) => a.categoryId),
      ...spendRows.map((s) => s.categoryId).filter((x): x is number => x != null),
    ]);
    const catRows = catIds.size
      ? await db.select().from(categories).where(and(
          eq(categories.userId, uid),
          sql`${categories.id} = ANY(${sql.raw('ARRAY[' + [...catIds].join(',') + ']')}::int[])`,
        ))
      : [];
    const nameBy = new Map(catRows.map((c) => [c.id, c.name]));

    // 7) Balance fold via envelope-math
    const balances = computeCategoryBalances(
      monthDate,
      asgnRows.map((a) => ({ categoryId: a.categoryId, month: a.month, amount: a.amount })),
      spendRows
        .filter((s): s is typeof s & { categoryId: number } => s.categoryId != null)
        .map((s) => ({ categoryId: s.categoryId, month: s.month, amount: s.amount })),
      settingsRows.map((s) => ({ categoryId: s.categoryId, overspendPolicy: s.overspendPolicy as 'rollover_negative' | 'reallocate_manual' })),
    );

    // 8) Prior-month total absorbed (for pool subtract)
    const priorBalances = computeCategoryBalances(
      // upToMonth = M-1 first-of-month
      // Compute via date_trunc-like string math on JS side:
      (() => {
        const [y, m] = monthYm.split('-').map(Number) as [number, number];
        const py = m === 1 ? y - 1 : y;
        const pm = m === 1 ? 12 : m - 1;
        return `${py}-${String(pm).padStart(2, '0')}-01`;
      })(),
      asgnRows.map((a) => ({ categoryId: a.categoryId, month: a.month, amount: a.amount })),
      spendRows
        .filter((s): s is typeof s & { categoryId: number } => s.categoryId != null)
        .map((s) => ({ categoryId: s.categoryId, month: s.month, amount: s.amount })),
      settingsRows.map((s) => ({ categoryId: s.categoryId, overspendPolicy: s.overspendPolicy as 'rollover_negative' | 'reallocate_manual' })),
    );
    const totalAbsorbedPrior = [...priorBalances.values()]
      .reduce((sum, b) => sum + Number(b.absorbedByPool), 0)
      .toFixed(2);

    const assignedCumul = asgnRows.reduce((sum, a) => sum + Number(a.amount), 0).toFixed(2);
    const incomeCumulative = Number(incomeAgg?.total ?? 0).toFixed(2);
    const pool = computePool({
      upToMonth: monthDate,
      incomeCumulative,
      assignmentCumulative: assignedCumul,
      holdThisMonth: holdThis,
      holdPriorMonth: holdPrev,
      totalAbsorbedPriorMonth: totalAbsorbedPrior,
    });

    // 9) Assemble rows for the requested month
    const rows = [...catIds].map((catId) => {
      const b = balances.get(catId) ?? { balance: '0.00', absorbedByPool: '0.00', overspent: false };
      const priorB = priorBalances.get(catId)?.balance ?? '0.00';
      const asgnThis = asgnRows
        .filter((a) => a.categoryId === catId && a.month === monthDate)
        .reduce((s, a) => s + Number(a.amount), 0).toFixed(2);
      const spendThis = spendRows
        .filter((s) => s.categoryId === catId && s.month === monthDate)
        .reduce((s, r) => s + Number(r.amount), 0).toFixed(2);
      const settings = settingsBy.get(catId);
      return {
        categoryId: catId,
        categoryName: nameBy.get(catId) ?? '',
        balancePriorMonth: priorB,
        assignment: asgnThis,
        spend: spendThis,
        balance: b.balance,
        target: settings?.targetAmount
          ? { amount: settings.targetAmount, date: settings.targetDate, kind: settings.targetKind! }
          : null,
        overspendPolicy: (settings?.overspendPolicy ?? 'rollover_negative') as
          'rollover_negative' | 'reallocate_manual',
        overspent: b.overspent,
        absorbedByPool: b.absorbedByPool,
        monthsToTarget: null as number | null,   // deferred; UI computes if desired
      };
    });

    return {
      month: monthYm,
      pool: {
        incomeCumulative,
        assignedCumulative: assignedCumul,
        heldFromPriorMonths: pool.heldFromPriorMonths,
        heldForNextMonth: pool.heldForNextMonth,
        available: pool.available,
      },
      rows,
    };
  });
}
