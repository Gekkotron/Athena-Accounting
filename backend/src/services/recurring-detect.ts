import { and, eq, gte } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { db } from '../db/client.js';
import {
  recurringSeries,
  recurringSeriesTransactions,
  transactions,
} from '../db/schema.js';
import { addDays } from '../domain/transfers/matching.js';
import {
  detectSeries,
  todayIso,
  type DetectionInputTx,
} from './recurring-detect-core.js';

// Re-export the pure primitives so callers can pick either entry point:
// this file for the DB-touching wrapper, or `-core.js` for the pure
// algorithm (unit-testable without env / driver).
export {
  detectSeries,
  type DetectionInputTx,
  type DetectedSeries,
} from './recurring-detect-core.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = PgTransaction<any, any, any>;

const LOOKBACK_DAYS = 365;

// Runs detection against the given user's transactions in the last
// LOOKBACK_DAYS days and reconciles the result into recurring_series +
// recurring_series_transactions. Rows in status='confirmed' or
// 'dismissed' keep their status and essentialness — only their stats
// and member set refresh when a matching pattern is still present.
// Rows in status='detected' are rebuilt from scratch each run.
export async function runRecurringDetection(
  tx: Tx,
  userId: number,
  now: Date = new Date(),
): Promise<{ detected: number; refreshed: number }> {
  const cutoff = addDays(todayIso(now), -LOOKBACK_DAYS);

  const rows = await tx
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      rawLabel: transactions.rawLabel,
      categoryId: transactions.categoryId,
      transferGroupId: transactions.transferGroupId,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), gte(transactions.date, cutoff)));

  // Transfer legs are internal movements, not recurring spending.
  const relevant: DetectionInputTx[] = rows
    .filter((r) => !r.transferGroupId)
    .map((r) => ({
      id: r.id,
      date: r.date,
      amount: r.amount,
      rawLabel: r.rawLabel,
      categoryId: r.categoryId,
    }));

  const detected = detectSeries(relevant);

  // Load existing series to preserve user decisions.
  const existing = await tx
    .select()
    .from(recurringSeries)
    .where(eq(recurringSeries.userId, userId));

  const preservedByKey = new Map<string, (typeof existing)[number]>();
  for (const s of existing) {
    if (s.status !== 'detected') {
      preservedByKey.set(`${s.label}|${s.cadenceDays}`, s);
    }
  }

  // Drop all detected-status rows (join rows cascade). Preserved rows
  // stay put; they get refreshed below if the detector still sees the
  // same pattern.
  await tx
    .delete(recurringSeries)
    .where(and(eq(recurringSeries.userId, userId), eq(recurringSeries.status, 'detected')));

  let insertedCount = 0;
  let refreshedCount = 0;

  for (const s of detected) {
    const key = `${s.label}|${s.cadenceDays}`;
    const preserved = preservedByKey.get(key);

    if (preserved) {
      await tx
        .update(recurringSeries)
        .set({
          avgAmount: s.avgAmount.toFixed(2),
          amountStddev: s.amountStddev.toFixed(2),
          categoryId: s.categoryId,
          firstSeenAt: s.firstSeenAt,
          lastSeenAt: s.lastSeenAt,
          nextDueAt: s.nextDueAt,
          updatedAt: now,
        })
        .where(eq(recurringSeries.id, preserved.id));

      await tx
        .delete(recurringSeriesTransactions)
        .where(eq(recurringSeriesTransactions.seriesId, preserved.id));

      if (s.memberIds.length > 0) {
        await tx.insert(recurringSeriesTransactions).values(
          s.memberIds.map((id) => ({ seriesId: preserved.id, transactionId: id })),
        );
      }
      refreshedCount++;
    } else {
      const [row] = await tx
        .insert(recurringSeries)
        .values({
          userId,
          label: s.label,
          cadenceDays: s.cadenceDays,
          avgAmount: s.avgAmount.toFixed(2),
          amountStddev: s.amountStddev.toFixed(2),
          categoryId: s.categoryId,
          firstSeenAt: s.firstSeenAt,
          lastSeenAt: s.lastSeenAt,
          nextDueAt: s.nextDueAt,
        })
        .returning({ id: recurringSeries.id });

      if (row && s.memberIds.length > 0) {
        await tx.insert(recurringSeriesTransactions).values(
          s.memberIds.map((id) => ({ seriesId: row.id, transactionId: id })),
        );
      }
      insertedCount++;
    }
  }

  return { detected: insertedCount, refreshed: refreshedCount };
}

// Convenience wrapper for callsites that don't already own a
// transaction (e.g. the /api/recurring/regenerate route).
export async function runRecurringDetectionStandalone(
  userId: number,
  now: Date = new Date(),
): Promise<{ detected: number; refreshed: number }> {
  return db.transaction(async (tx) => runRecurringDetection(tx, userId, now));
}
