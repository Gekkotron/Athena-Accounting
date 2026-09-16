// Perf-audit regression guard for the batched post-commit fan-out
// (afterTransactionsBatchInserted). Pre-refactor, importing N rows meant
// N calls to loadPrefs AND N calls to computeEnvelope / fetchBudgetRows.
// This test pins the fetchBudgetRows cap at ≤ DISTINCT-categoryId count.
// The loadPrefs-once claim is a code-inspection invariant in hooks.ts:
// vi.spyOn on an ESM named export can't intercept the internal call from
// afterTransactionsBatchInserted, so we assert the aggregate count only.
// Requires RUN_DB_TESTS=1 (envelope aggregate hits the DB).
import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

// Partial-mock budget-queries to spy on the fan-out entry point without
// changing behaviour. envelope-check.ts imports fetchBudgetRows from this
// module, and hooks.ts imports computeEnvelope from envelope-check, so the
// spy fires on every batched-hook envelope check downstream.
vi.mock('../src/http/routes/reports/budget-queries.js', async () => {
  const actual = await vi.importActual<typeof import('../src/http/routes/reports/budget-queries.js')>(
    '../src/http/routes/reports/budget-queries.js',
  );
  return { ...actual, fetchBudgetRows: vi.fn(actual.fetchBudgetRows) };
});

d('afterTransactionsBatchInserted — batched fan-out', () => {
  it('fetchBudgetRows ≤ N distinct categories for a multi-tx batch', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie, seedAccount } = await import('./helpers/seedUserAndCookie.js');
    const { fetchBudgetRows } = await import('../src/http/routes/reports/budget-queries.js');
    const { afterTransactionsBatchInserted } = await import('../src/domain/notifications/hooks.js');
    const { db } = await import('../src/db/client.js');
    const { categories, categoryBudgets } = await import('../src/db/schema.js');

    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid, { openingBalance: '1000.00' });

    // Three categories with monthly budgets — the batch below spans all
    // three, plus repeats, so the count assertion catches the per-row
    // fan-out regressing.
    const catRows = await db.insert(categories).values([
      { userId: uid, name: 'Alpha', kind: 'expense', isDefault: false },
      { userId: uid, name: 'Bravo', kind: 'expense', isDefault: false },
      { userId: uid, name: 'Charlie', kind: 'expense', isDefault: false },
    ]).returning({ id: categories.id });
    const [catA, catB, catC] = catRows.map((r) => r.id);
    await db.insert(categoryBudgets).values([
      { userId: uid, categoryId: catA!, monthlyLimit: '100.00', period: 'monthly' },
      { userId: uid, categoryId: catB!, monthlyLimit: '100.00', period: 'monthly' },
      { userId: uid, categoryId: catC!, monthlyLimit: '100.00', period: 'monthly' },
    ]);

    // Enable the envelope trigger (defaults are all off).
    await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { cookie },
      payload: { notifications: { triggers: { envelopeExceeded: { enabled: true } } } },
    });

    const fetchSpy = vi.mocked(fetchBudgetRows);
    fetchSpy.mockClear();

    // 7 synthetic rows across 3 distinct categories (repetition on catA + catB).
    // Pre-refactor: 7 fetchBudgetRows. Batched: exactly 3.
    const batch = {
      accountId,
      newBalance: 1000,
      transactions: [
        { id: 1, amount: -10, merchant: 'x', categoryId: catA! },
        { id: 2, amount: -10, merchant: 'x', categoryId: catA! },
        { id: 3, amount: -10, merchant: 'x', categoryId: catB! },
        { id: 4, amount: -10, merchant: 'x', categoryId: catB! },
        { id: 5, amount: -10, merchant: 'x', categoryId: catC! },
        { id: 6, amount: -10, merchant: 'x', categoryId: catC! },
        { id: 7, amount: -10, merchant: 'x', categoryId: catA! },
      ],
    };
    await afterTransactionsBatchInserted(uid, batch);

    expect(fetchSpy.mock.calls.length).toBe(3);

    // Behaviour: no envelope was actually exceeded (7 × 10 € = 70 < 100 per
    // category), so no notification landed. The perf claim is about call
    // count only; the "notification behaviour unchanged" leg of the success
    // criteria is covered by the existing notifications-triggers suite.
    const { notifications } = await import('../src/db/schema.js');
    const notifRows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(notifRows.filter((r) => r.kind === 'envelope_exceeded')).toHaveLength(0);

    await app.close();
  });
});
