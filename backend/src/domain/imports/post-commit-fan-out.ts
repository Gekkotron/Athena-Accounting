import { inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { transactions } from '../../db/schema.js';
import { afterTransactionsBatchInserted, computeCurrentBalance } from '../notifications/hooks.js';
import { runRecurringDetectionStandalone } from '../../services/recurring-detect.js';
import { trace } from './import-trace.js';

// Post-commit work that used to live at the tail of runImport. Split out
// so import-service.ts stays a thin orchestrator: after the import
// transaction commits, we (1) batch-dispatch notification triggers over
// the fresh rows, and (2) kick off recurring-series detection
// fire-and-forget (it gets its own transaction and can also be re-run
// via POST /api/recurring/regenerate). Neither can throw into the caller.
export async function runPostCommitFanOut(
  opts: { userId: number; accountId: number },
  insertedIds: number[],
  tCommitted: number,
): Promise<void> {
  if (insertedIds.length > 0) {
    const freshRows = await db
      .select({
        id: transactions.id,
        amount: transactions.amount,
        rawLabel: transactions.rawLabel,
        categoryId: transactions.categoryId,
      })
      .from(transactions)
      .where(inArray(transactions.id, insertedIds));
    const newBalance = await computeCurrentBalance(opts.userId, opts.accountId);
    await afterTransactionsBatchInserted(opts.userId, {
      accountId: opts.accountId,
      newBalance,
      transactions: freshRows.map((row) => ({
        id: row.id,
        amount: Number(row.amount),
        merchant: row.rawLabel,
        categoryId: row.categoryId,
      })),
    });
  }

  // Recurring-series detection was previously awaited inside the import
  // transaction — clustering the last 12 months of transactions on PGlite
  // (single-threaded WASM) can take many seconds on a 500-row import,
  // during which the /api/imports request never responds and the UI stays
  // stuck on the preview modal. Kick it off fire-and-forget instead.
  runRecurringDetectionStandalone(opts.userId)
    .then((r) => {
      trace(`recurring detection: detected=${r.detected} refreshed=${r.refreshed} elapsed=${Date.now() - tCommitted}ms`);
    })
    .catch((err) => {
      trace(`recurring detection FAILED: ${err instanceof Error ? err.message : String(err)}`);
    });
}
