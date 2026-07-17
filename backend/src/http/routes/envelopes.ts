// Envelope-mode budgeting routes. Independent of /api/budgets — the two
// modes do not share tables. See docs/superpowers/specs/2026-07-16-budget-modes-design.md.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  categories,
  envelopeAssignments,
  envelopeCategorySettings,
  envelopeMonthHolds,
  transactions,
} from '../../db/schema.js';
import { computeCategoryBalances, computePool } from '../../lib/envelope-math.js';
import { userId } from '../plugins/auth.js';

const signedDecimal = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 fraction digits');

const monthStr = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM')
  .transform((s) => `${s}-01`);

const currency = z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code');

const IdParam = z.object({ id: z.coerce.number().int().positive() });

function parseId(req: FastifyRequest, reply: FastifyReply): number | null {
  const r = IdParam.safeParse(req.params);
  if (!r.success) { reply.code(400).send({ error: 'invalid id' }); return null; }
  return r.data.id;
}

async function expenseCategoryOwned(uid: number, categoryId: number): Promise<boolean> {
  const [row] = await db
    .select({ kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, uid)));
  return !!row && row.kind === 'expense';
}

function serializeAssignment(row: typeof envelopeAssignments.$inferSelect) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    month: row.month.slice(0, 7),          // wire form "YYYY-MM" (DB stores first-of-month DATE)
    amount: row.amount,
    currency: row.currency,
  };
}

function serializeSettings(row: typeof envelopeCategorySettings.$inferSelect) {
  return {
    categoryId: row.categoryId,
    targetAmount: row.targetAmount,
    targetDate: row.targetDate,
    targetKind: row.targetKind,
    overspendPolicy: row.overspendPolicy,
  };
}

function serializeHold(row: typeof envelopeMonthHolds.$inferSelect) {
  return {
    month: row.month.slice(0, 7),          // wire form "YYYY-MM" (DB stores first-of-month DATE)
    amount: row.amount,
  };
}

export async function envelopesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // ---------- Assignments ----------

  const AsgListQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
  app.get('/api/envelopes/assignments', async (req, reply) => {
    const uid = userId(req);
    const parsed = AsgListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid month' });
    const month = `${parsed.data.month}-01`;
    const rows = await db
      .select()
      .from(envelopeAssignments)
      .where(and(eq(envelopeAssignments.userId, uid), eq(envelopeAssignments.month, month)))
      .orderBy(asc(envelopeAssignments.categoryId));
    return { assignments: rows.map(serializeAssignment) };
  });

  const AsgPutBody = z.object({
    categoryId: z.number().int().positive(),
    month: monthStr,
    amount: signedDecimal,
    currency: currency.optional(),
  });
  app.put('/api/envelopes/assignments', async (req, reply) => {
    const uid = userId(req);
    const parsed = AsgPutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (!(await expenseCategoryOwned(uid, parsed.data.categoryId))) {
      return reply.code(400).send({ error: 'category_not_expense' });
    }
    const [row] = await db
      .insert(envelopeAssignments)
      .values({
        userId: uid,
        categoryId: parsed.data.categoryId,
        month: parsed.data.month,
        amount: parsed.data.amount,
        currency: parsed.data.currency ?? 'EUR',
      })
      .onConflictDoUpdate({
        target: [envelopeAssignments.userId, envelopeAssignments.categoryId, envelopeAssignments.month],
        set: {
          amount: sql`excluded.amount`,
          currency: sql`excluded.currency`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return reply.code(201).send({ assignment: serializeAssignment(row!) });
  });

  app.delete('/api/envelopes/assignments/:id', async (req, reply) => {
    const uid = userId(req);
    const id = parseId(req, reply);
    if (id === null) return;
    const [deleted] = await db
      .delete(envelopeAssignments)
      .where(and(eq(envelopeAssignments.id, id), eq(envelopeAssignments.userId, uid)))
      .returning({ id: envelopeAssignments.id });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // ---------- Reallocate ----------

  const ReallocBody = z.object({
    fromCategoryId: z.number().int().positive(),
    toCategoryId: z.number().int().positive(),
    month: monthStr,
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'must be a positive decimal'),
  });
  app.post('/api/envelopes/reallocate', async (req, reply) => {
    const uid = userId(req);
    const parsed = ReallocBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { fromCategoryId, toCategoryId, month, amount } = parsed.data;
    if (fromCategoryId === toCategoryId) {
      return reply.code(400).send({ error: 'same_category' });
    }
    if (!(await expenseCategoryOwned(uid, fromCategoryId))
      || !(await expenseCategoryOwned(uid, toCategoryId))) {
      return reply.code(400).send({ error: 'category_not_expense' });
    }

    const result = await db.transaction(async (tx) => {
      async function bumpBy(catId: number, delta: string) {
        // Upsert: current amount is unknown; use SQL expression to add.
        const [existing] = await tx
          .select()
          .from(envelopeAssignments)
          .where(and(
            eq(envelopeAssignments.userId, uid),
            eq(envelopeAssignments.categoryId, catId),
            eq(envelopeAssignments.month, month),
          ));
        if (existing) {
          const [updated] = await tx
            .update(envelopeAssignments)
            .set({
              amount: sql`${envelopeAssignments.amount} + ${delta}::numeric`,
              updatedAt: new Date(),
            })
            .where(and(
              eq(envelopeAssignments.id, existing.id),
              eq(envelopeAssignments.userId, uid),
            ))
            .returning();
          return updated!;
        }
        const [created] = await tx
          .insert(envelopeAssignments)
          .values({
            userId: uid,
            categoryId: catId,
            month,
            amount: delta,
          })
          .returning();
        return created!;
      }

      const from = await bumpBy(fromCategoryId, `-${amount}`);
      const to = await bumpBy(toCategoryId, amount);
      return { from, to };
    });

    return reply.code(200).send({
      from: serializeAssignment(result.from),
      to:   serializeAssignment(result.to),
    });
  });

  // ---------- Category settings ----------

  app.get('/api/envelopes/categories', async (req) => {
    const uid = userId(req);
    const rows = await db
      .select()
      .from(envelopeCategorySettings)
      .where(eq(envelopeCategorySettings.userId, uid))
      .orderBy(asc(envelopeCategorySettings.categoryId));
    return { settings: rows.map(serializeSettings) };
  });

  const SettingsPutBody = z.object({
    targetAmount: signedDecimal.nullable().optional(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    targetKind: z.enum(['save_by_date', 'monthly_recurring', 'save_up_to']).nullable().optional(),
    overspendPolicy: z.enum(['rollover_negative', 'reallocate_manual']).optional(),
  }).superRefine((data, ctx) => {
    if (data.targetAmount != null && data.targetKind == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'target_kind_required_with_target_amount',
        path: ['targetKind'],
      });
    }
  });
  const SettingsCatIdParam = z.object({ categoryId: z.coerce.number().int().positive() });

  app.put('/api/envelopes/categories/:categoryId', async (req, reply) => {
    const uid = userId(req);
    const idP = SettingsCatIdParam.safeParse(req.params);
    if (!idP.success) return reply.code(400).send({ error: 'invalid id' });
    const parsed = SettingsPutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    if (!(await expenseCategoryOwned(uid, idP.data.categoryId))) {
      return reply.code(400).send({ error: 'category_not_expense' });
    }
    const values = {
      userId: uid,
      categoryId: idP.data.categoryId,
      targetAmount: parsed.data.targetAmount ?? null,
      targetDate: parsed.data.targetDate ?? null,
      targetKind: parsed.data.targetKind ?? null,
      overspendPolicy: parsed.data.overspendPolicy ?? 'rollover_negative',
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(envelopeCategorySettings)
      .values(values)
      .onConflictDoUpdate({
        target: [envelopeCategorySettings.userId, envelopeCategorySettings.categoryId],
        set: {
          targetAmount: values.targetAmount,
          targetDate: values.targetDate,
          targetKind: values.targetKind,
          overspendPolicy: values.overspendPolicy,
          updatedAt: values.updatedAt,
        },
      })
      .returning();
    return { settings: serializeSettings(row!) };
  });

  app.delete('/api/envelopes/categories/:categoryId', async (req, reply) => {
    const uid = userId(req);
    const idP = SettingsCatIdParam.safeParse(req.params);
    if (!idP.success) return reply.code(400).send({ error: 'invalid id' });
    const [deleted] = await db
      .delete(envelopeCategorySettings)
      .where(and(
        eq(envelopeCategorySettings.userId, uid),
        eq(envelopeCategorySettings.categoryId, idP.data.categoryId),
      ))
      .returning({ categoryId: envelopeCategorySettings.categoryId });
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // ---------- Holds ----------

  const HoldsQuery = z.object({
    from: z.string().regex(/^\d{4}-\d{2}$/).transform((s) => `${s}-01`),
    to:   z.string().regex(/^\d{4}-\d{2}$/).transform((s) => `${s}-01`),
  });
  app.get('/api/envelopes/holds', async (req, reply) => {
    const uid = userId(req);
    const parsed = HoldsQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid range' });
    const rows = await db
      .select()
      .from(envelopeMonthHolds)
      .where(and(
        eq(envelopeMonthHolds.userId, uid),
        gte(envelopeMonthHolds.month, parsed.data.from),
        lte(envelopeMonthHolds.month, parsed.data.to),
      ))
      .orderBy(asc(envelopeMonthHolds.month));
    return { holds: rows.map(serializeHold) };
  });

  const HoldPutBody = z.object({
    month: monthStr,
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'must be a non-negative decimal'),
  });
  app.put('/api/envelopes/holds', async (req, reply) => {
    const uid = userId(req);
    const parsed = HoldPutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { month, amount } = parsed.data;
    if (Number(amount) === 0) {
      await db
        .delete(envelopeMonthHolds)
        .where(and(eq(envelopeMonthHolds.userId, uid), eq(envelopeMonthHolds.month, month)));
      return { deleted: true };
    }
    const [row] = await db
      .insert(envelopeMonthHolds)
      .values({ userId: uid, month, amount })
      .onConflictDoUpdate({
        target: [envelopeMonthHolds.userId, envelopeMonthHolds.month],
        set: { amount, updatedAt: new Date() },
      })
      .returning();
    return { hold: serializeHold(row!) };
  });

  // ---------- Report ----------

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
