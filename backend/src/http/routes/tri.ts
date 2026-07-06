import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { categories, rules, transactions } from '../../db/schema.js';
import { userId } from '../plugins/auth.js';

const GroupsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const AssignBody = z.object({
  groups: z
    .array(
      z.object({
        normalizedLabel: z.string().min(1).max(256),
        categoryId: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(100),
  createRules: z.boolean().default(false),
});

export async function triRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // List groups of "to be categorized" transactions, bundled by normalized
  // label. A transaction is in the bucket when it has no category OR when its
  // category_source is 'default' (i.e. the rule engine punted to Divers).
  // Groups are returned most-frequent first so a handful of clicks can clear
  // the long tail.
  app.get('/api/tri/groups', async (req, reply) => {
    const uid = userId(req);
    const parsed = GroupsQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const { limit, offset } = parsed.data;

    const rows = await db.execute<{
      normalized_label: string;
      transaction_count: number;
      total_amount: string;
      example_raw_label: string;
      example_id: number;
      min_date: string;
      max_date: string;
    }>(sql`
      SELECT
        t.normalized_label,
        COUNT(*)::int AS transaction_count,
        SUM(t.amount)::text AS total_amount,
        (ARRAY_AGG(t.raw_label ORDER BY t.date DESC))[1] AS example_raw_label,
        (ARRAY_AGG(t.id ORDER BY t.date DESC))[1] AS example_id,
        MIN(t.date)::text AS min_date,
        MAX(t.date)::text AS max_date
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ${uid}
        AND t.transfer_group_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
        AND (t.category_id IS NULL OR c.is_default = TRUE OR t.category_source = 'default')
      GROUP BY t.normalized_label
      ORDER BY transaction_count DESC, t.normalized_label
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    const totalRow = await db.execute<{ total: number }>(sql`
      SELECT COUNT(DISTINCT t.normalized_label)::int AS total
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ${uid}
        AND t.transfer_group_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
        AND (t.category_id IS NULL OR c.is_default = TRUE OR t.category_source = 'default')
    `);

    return {
      groups: rows.rows,
      pagination: { total: totalRow.rows[0]?.total ?? 0, limit, offset },
    };
  });

  // Bulk-assign a category to all transactions sharing a normalized_label.
  // Optionally generate a "word" rule for the assigned label so future
  // imports get categorized automatically. category_source is set to 'manual'
  // (these are the user's deliberate choices).
  app.post('/api/tri/assign', async (req, reply) => {
    const uid = userId(req);
    const parsed = AssignBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { groups, createRules } = parsed.data;

    // Validate that all categories exist AND belong to the current user.
    const wantedCategoryIds = Array.from(new Set(groups.map((g) => g.categoryId)));
    const cats = await db
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.userId, uid), inArray(categories.id, wantedCategoryIds)));
    if (cats.length !== wantedCategoryIds.length) {
      return reply.code(400).send({ error: 'one or more categoryId values do not exist' });
    }
    const catKind = new Map(cats.map((c) => [c.id, c.kind] as const));

    let assigned = 0;
    let rulesCreated = 0;

    for (const g of groups) {
      // Only touch transactions that are still "to be categorized" — never
      // overwrite a manual choice the user already made on a sibling row.
      const result = await db
        .update(transactions)
        .set({ categoryId: g.categoryId, categorySource: 'manual' })
        .where(
          and(
            eq(transactions.userId, uid),
            eq(transactions.normalizedLabel, g.normalizedLabel),
            isNull(transactions.transferGroupId),
            or(
              isNull(transactions.categoryId),
              eq(transactions.categorySource, 'default'),
              eq(transactions.categorySource, 'auto'),
            ),
          ),
        )
        .returning({ id: transactions.id });
      assigned += result.length;

      if (createRules) {
        const kind = catKind.get(g.categoryId);
        const signConstraint =
          kind === 'expense'
            ? 'negative'
            : kind === 'income'
              ? 'positive'
              : 'any';

        await db.insert(rules).values({
          userId: uid,
          categoryId: g.categoryId,
          keyword: g.normalizedLabel,
          signConstraint,
          matchMode: 'word',
          priority: 100,
          enabled: true,
        });
        rulesCreated++;
      }
    }

    return { assigned, rulesCreated };
  });
}
