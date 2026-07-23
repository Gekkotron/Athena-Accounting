import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { userId } from '../../plugins/auth.js';
import { RangeQuery } from './schemas.js';

export function registerTimeseriesRoute(app: FastifyInstance): void {
  // Running balance per account over time. Returns one row per (account, date)
  // with the cumulative balance after that date's transactions. Transfer legs
  // ARE included here — they affect per-account balances even though they're
  // neutral overall.
  app.get('/api/reports/timeseries', async (req, reply) => {
    const uid = userId(req);
    const parsed = RangeQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const { fromDate, toDate, granularity } = parsed.data;

    const truncFmt = granularity === 'month' ? "'month'" : "'day'";

    const rows = await db.execute<{
      account_id: number;
      currency: string;
      bucket: string;
      delta: string;
      cumulative: string;
    }>(sql`
      WITH per_bucket AS (
        SELECT
          t.account_id,
          a.currency,
          to_char(date_trunc(${sql.raw(truncFmt)}, t.date::timestamp), 'YYYY-MM-DD') AS bucket,
          SUM(t.amount) AS delta
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE t.user_id = ${uid}
          ${fromDate ? sql`AND t.date >= ${fromDate}` : sql``}
          ${toDate ? sql`AND t.date <= ${toDate}` : sql``}
        GROUP BY t.account_id, a.currency, bucket
      ),
      with_opening AS (
        SELECT
          a.id AS account_id,
          a.currency,
          'opening' AS kind,
          to_char(a.opening_date::timestamp, 'YYYY-MM-DD') AS bucket,
          a.opening_balance AS delta
        FROM accounts a
        WHERE a.user_id = ${uid}
        UNION ALL
        SELECT account_id, currency, 'tx' AS kind, bucket, delta FROM per_bucket
      ),
      with_cumulative AS (
        SELECT
          account_id,
          currency,
          bucket,
          SUM(delta) AS delta,
          SUM(SUM(delta)) OVER (
            PARTITION BY account_id
            ORDER BY bucket
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS cumulative
        FROM with_opening
        GROUP BY account_id, currency, bucket
      )
      -- Clip the opening bucket to the requested window AFTER the cumulative
      -- sum runs, so the first surviving row's cumulative already includes
      -- the opening balance instead of the client receiving a stray point
      -- dated years before fromDate (accounts opened in 2020 answering a
      -- 2026 range).
      SELECT
        account_id,
        currency,
        bucket,
        delta::text AS delta,
        cumulative::text AS cumulative
      FROM with_cumulative
      WHERE 1 = 1
        ${fromDate ? sql`AND bucket >= ${fromDate}` : sql``}
        ${toDate ? sql`AND bucket <= ${toDate}` : sql``}
      ORDER BY account_id, bucket
    `);

    return { points: rows.rows };
  });
}
