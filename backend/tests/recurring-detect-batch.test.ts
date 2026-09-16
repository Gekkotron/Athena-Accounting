// Perf-audit regression guard for the batched runRecurringDetection
// (2026-09-11 audit). Pre-refactor the loop paid 2-3 sequential
// round-trips per detected series (UPDATE|INSERT + DELETE members +
// INSERT members). The batched version collapses that to 3 statements
// regardless of series count: one ON CONFLICT DO UPDATE, one bulk
// DELETE of prior member rows, one multi-values INSERT for the fresh
// members. Verified here by counting insert/update/delete calls on a
// Proxy-wrapped tx runner — the count must be constant when the
// detected-series count grows from 1 → 3.
// Requires RUN_DB_TESTS=1 (touches the DB for its side effects).
import { describe, it, expect } from 'vitest';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countingProxy(tx: any): { tx: any; counts: { insert: number; update: number; delete: number } } {
  const counts = { insert: 0, update: 0, delete: 0 };
  const wrapped = new Proxy(tx, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'insert' || prop === 'update' || prop === 'delete') {
        return (...args: unknown[]) => {
          counts[prop as 'insert' | 'update' | 'delete']++;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (value as any).apply(target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { tx: wrapped, counts };
}

async function seedMonthly(uid: number, accountId: number, label: string, amount: string, months: number, startId: number) {
  const { db } = await import('../src/db/client.js');
  const { transactions } = await import('../src/db/schema.js');
  const rows = Array.from({ length: months }, (_, i) => {
    const monthIdx = i + 1;
    const year = 2026;
    const iso = `${year}-${String(monthIdx).padStart(2, '0')}-15`;
    return {
      userId: uid, accountId, date: iso, amount,
      rawLabel: `${label} ${monthIdx}`, normalizedLabel: label.toLowerCase(),
      dedupKey: `${label}-${startId + i}`, categorySource: 'auto' as const,
    };
  });
  await db.insert(transactions).values(rows);
}

async function runDetectionWithCounter(uid: number, now: Date) {
  const { db } = await import('../src/db/client.js');
  const { runRecurringDetection } = await import('../src/services/recurring-detect.js');
  let counts = { insert: 0, update: 0, delete: 0 };
  await db.transaction(async (tx) => {
    const wrapped = countingProxy(tx);
    counts = wrapped.counts;
    await runRecurringDetection(wrapped.tx, uid, now);
  });
  return counts;
}

d('runRecurringDetection — batched write path', () => {
  it('statement count stays constant as detected-series count grows (1 → 3)', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie, seedAccount } = await import('./helpers/seedUserAndCookie.js');
    const { db } = await import('../src/db/client.js');
    const { recurringSeries, recurringSeriesTransactions, transactions } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const app = await buildApp();
    const { uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);
    const now = new Date('2026-12-31T00:00:00Z');

    // 1 series → run detection → snapshot the counts.
    await seedMonthly(uid, accountId, 'ALPHA', '-9.99', 12, 100);
    const oneCounts = await runDetectionWithCounter(uid, now);
    const seriesAfterOne = await db.select().from(recurringSeries).where(eq(recurringSeries.userId, uid));
    expect(seriesAfterOne.length).toBe(1);

    // Wipe series so the next run starts from an equivalent baseline.
    await db.delete(recurringSeriesTransactions).where(eq(recurringSeriesTransactions.seriesId, seriesAfterOne[0]!.id));
    await db.delete(recurringSeries).where(eq(recurringSeries.userId, uid));

    // Add two more monthly series (BRAVO, CHARLIE) — same shape, distinct labels.
    await seedMonthly(uid, accountId, 'BRAVO', '-19.99', 12, 200);
    await seedMonthly(uid, accountId, 'CHARLIE', '-29.99', 12, 300);
    const threeCounts = await runDetectionWithCounter(uid, now);
    const seriesAfterThree = await db.select().from(recurringSeries).where(eq(recurringSeries.userId, uid));
    expect(seriesAfterThree.length).toBe(3);

    // The perf claim: the counts do NOT scale with the detected-series count.
    // Pre-refactor, adding two more series would add 4-6 extra writes.
    expect(threeCounts.insert).toBe(oneCounts.insert);
    expect(threeCounts.update).toBe(oneCounts.update);
    expect(threeCounts.delete).toBe(oneCounts.delete);
    // And the total write-op count is bounded: one initial delete (drops
    // detected-status rows) + up to three batched writes (upsert, delete
    // members, insert members) = ≤ 4.
    const totalWrites = threeCounts.insert + threeCounts.update + threeCounts.delete;
    expect(totalWrites).toBeLessThanOrEqual(4);

    // Cleanup for hygiene.
    await db.delete(transactions).where(eq(transactions.userId, uid));
    await app.close();
  });

  it('refresh-only run (all series preserved) still runs in constant writes', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie, seedAccount } = await import('./helpers/seedUserAndCookie.js');
    const { db } = await import('../src/db/client.js');
    const { recurringSeries, transactions } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const app = await buildApp();
    const { uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);
    const now = new Date('2026-12-31T00:00:00Z');

    await seedMonthly(uid, accountId, 'DELTA', '-5.55', 12, 400);
    await seedMonthly(uid, accountId, 'ECHO', '-6.66', 12, 500);
    // First run — inserts as 'detected'.
    await runDetectionWithCounter(uid, now);
    // Flip both to 'confirmed' so the next run refreshes rather than
    // rebuilding from scratch (only 'detected' status rows get dropped
    // upfront in runRecurringDetection).
    await db.update(recurringSeries)
      .set({ status: 'confirmed' })
      .where(eq(recurringSeries.userId, uid));

    const refreshCounts = await runDetectionWithCounter(uid, now);
    const total = refreshCounts.insert + refreshCounts.update + refreshCounts.delete;
    expect(total).toBeLessThanOrEqual(4);

    await db.delete(transactions).where(eq(transactions.userId, uid));
    await app.close();
  });
});
