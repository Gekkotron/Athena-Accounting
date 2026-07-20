import { sql } from 'drizzle-orm';

// Shared "effective transactions" CTE body: a transaction with no splits
// contributes itself; a split transaction contributes one row per split.
// Used by both the categories report and the budget report so they count
// splits identically. Includes account_id — the categories report filters
// on it; the budget report ignores that column.
export const TX_EFFECTIVE_CTE = sql`
      tx_effective AS (
        SELECT t.id, t.user_id, t.account_id, t.date, t.transfer_group_id,
               t.category_id, t.amount
          FROM transactions t
         WHERE NOT EXISTS (
           SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id
         )
        UNION ALL
        SELECT t.id, t.user_id, t.account_id, t.date, t.transfer_group_id,
               s.category_id, s.amount
          FROM transactions t
          JOIN transaction_splits s ON s.transaction_id = t.id
      )`;
