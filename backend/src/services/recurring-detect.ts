import { and, eq, gte, inArray, sql } from 'drizzle-orm';
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

  // Split the counts up-front from the JS-side preservedByKey map — cheaper
  // than distinguishing INSERT vs. UPDATE from the RETURNING result and
  // keeps the API surface stable for callers.
  let insertedCount = 0;
  let refreshedCount = 0;
  for (const s of detected) {
    if (preservedByKey.has(`${s.label}|${s.cadenceDays}`)) refreshedCount++;
    else insertedCount++;
  }

  if (detected.length === 0) {
    return { detected: insertedCount, refreshed: refreshedCount };
  }

  // Batched write path (perf audit 2026-09-11) — the pre-refactor loop
  // paid 2-3 sequential round-trips per detected series (UPDATE|INSERT
  // + DELETE members + INSERT members). Collapse to 3 statements
  // regardless of detected-series count:
  //   1. One INSERT ... ON CONFLICT (user_id, label, cadence_days)
  //      DO UPDATE that either inserts a fresh 'detected' row or
  //      refreshes the stats on a preserved row (never touches status /
  //      essentialness). RETURNING gives us id + label + cadence_days
  //      so we can map (series → id) without a second SELECT.
  //   2. One DELETE FROM recurring_series_transactions WHERE series_id
  //      IN (...) clears every affected series's prior member set in
  //      one round-trip.
  //   3. One multi-values INSERT INTO recurring_series_transactions
  //      writes every series's fresh member set at once.
  const upserted = await tx
    .insert(recurringSeries)
    .values(detected.map((s) => ({
      userId,
      label: s.label,
      cadenceDays: s.cadenceDays,
      avgAmount: s.avgAmount.toFixed(2),
      amountStddev: s.amountStddev.toFixed(2),
      categoryId: s.categoryId,
      firstSeenAt: s.firstSeenAt,
      lastSeenAt: s.lastSeenAt,
      nextDueAt: s.nextDueAt,
    })))
    .onConflictDoUpdate({
      target: [recurringSeries.userId, recurringSeries.label, recurringSeries.cadenceDays],
      set: {
        avgAmount: sql`excluded.avg_amount`,
        amountStddev: sql`excluded.amount_stddev`,
        categoryId: sql`excluded.category_id`,
        firstSeenAt: sql`excluded.first_seen_at`,
        lastSeenAt: sql`excluded.last_seen_at`,
        nextDueAt: sql`excluded.next_due_at`,
        updatedAt: now,
      },
    })
    .returning({
      id: recurringSeries.id,
      label: recurringSeries.label,
      cadenceDays: recurringSeries.cadenceDays,
    });

  const idByKey = new Map<string, number>();
  for (const r of upserted) {
    idByKey.set(`${r.label}|${r.cadenceDays}`, r.id);
  }

  const affectedIds = upserted.map((r) => r.id);
  if (affectedIds.length > 0) {
    await tx
      .delete(recurringSeriesTransactions)
      .where(inArray(recurringSeriesTransactions.seriesId, affectedIds));
  }

  const memberRows: Array<{ seriesId: number; transactionId: number }> = [];
  for (const s of detected) {
    const seriesId = idByKey.get(`${s.label}|${s.cadenceDays}`);
    if (seriesId == null) continue;
    for (const memberId of s.memberIds) {
      memberRows.push({ seriesId, transactionId: memberId });
    }
  }
  if (memberRows.length > 0) {
    await tx.insert(recurringSeriesTransactions).values(memberRows);
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
