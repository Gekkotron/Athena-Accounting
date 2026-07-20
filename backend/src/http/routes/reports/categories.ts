import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';
import { RangeQuery } from './schemas.js';
import { TX_EFFECTIVE_CTE } from './sql-fragments.js';

export function registerCategoriesReportRoute(app: FastifyInstance): void {
  // Spending breakdown by category over a date range. Excludes transfers and
  // excludes positive-only category kinds when the user is only interested in
  // expenses (we just return everything and let the UI filter — keeps the API
  // simple).
  app.get('/api/reports/categories', async (req, reply) => {
    const uid = userId(req);
    const parsed = RangeQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const { fromDate, toDate, accountId } = parsed.data;

    const rows = await db.execute<{
      category_id: number | null;
      category_name: string | null;
      category_kind: string | null;
      category_is_internal_transfer: boolean | null;
      month: string;
      total: string;
      transaction_count: number;
    }>(sql`
      -- transaction_count below counts virtual rows: a transaction with no
      -- splits contributes 1, but an N-way split contributes N rows (one per
      -- split), each attributed to its own split category.
      WITH ${TX_EFFECTIVE_CTE}
      SELECT
        c.id AS category_id,
        c.name AS category_name,
        c.kind AS category_kind,
        c.is_internal_transfer AS category_is_internal_transfer,
        to_char(date_trunc('month', e.date::timestamp), 'YYYY-MM') AS month,
        SUM(e.amount)::text AS total,
        COUNT(*)::int AS transaction_count
      FROM tx_effective e
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.user_id = ${uid}
        AND e.transfer_group_id IS NULL
        ${fromDate ? sql`AND e.date >= ${fromDate}` : sql``}
        ${toDate ? sql`AND e.date <= ${toDate}` : sql``}
        ${accountId ? sql`AND e.account_id = ${accountId}` : sql``}
      GROUP BY c.id, c.name, c.kind, month
      ORDER BY month DESC, total ASC
    `);

    return { rows: rows.rows };
  });
}
