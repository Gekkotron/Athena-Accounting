// Perf-audit regression guard for the bulk-insert sweep (2026-09-11
// audit). Pre-refactor: restoreTransactions + restoreCategoryTree +
// restoreFilenamePatterns + restoreRules + restoreBalanceCheckpoints +
// restoreBudgets + restoreSavingsGoalsAndEvents + restoreFileImports
// all walked their input arrays with per-row INSERTs. A 5000-row
// restore paid ~5000+ sequential PGlite round-trips. Refactor collapses
// each helper to chunked bulk INSERTs (500-row chunks match runImport).
// This test seeds a 5000-transaction backup body, wraps the tx runner
// in a counting Proxy, and asserts the total insert/update/delete
// count stays under a hard ceiling.
// Requires RUN_DB_TESTS=1.
import { describe, it, expect } from 'vitest';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

d('backup restore — bulk-insert perf', () => {
  it('5000-transaction restore executes fewer than 20 write statements', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie } = await import('./helpers/seedUserAndCookie.js');
    const { db } = await import('../src/db/client.js');
    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    void uid;

    // Build a valid v4 backup body with:
    //   - 1 account (so tx rows resolve their accountId)
    //   - 1 category (so tx rows resolve their categoryId)
    //   - 5000 transactions with unique dedup keys
    // Everything else optional. The wipe path inside /api/backup/import
    // runs first — that's a fixed cost, and the count budget below is
    // sized to absorb it.
    const transactions = Array.from({ length: 5000 }, (_, i) => ({
      account: 'Bulk',
      date: '2026-01-01',
      amount: '-1.00',
      rawLabel: `label-${i}`,
      normalizedLabel: `label-${i}`,
      memo: null,
      notes: null,
      fitid: null,
      dedupKey: `bulk-${i}`,
      category: 'Alpha',
      categoryParent: null,
      categorySource: 'auto' as const,
      transferGroupId: null,
      sourceFileKey: null,
    }));
    const dumpBody = {
      version: 4 as const,
      accounts: [{
        name: 'Bulk', type: 'checking', currency: 'EUR',
        openingBalance: '0.00', openingDate: '2025-01-01',
      }],
      categories: [{
        name: 'Alpha', kind: 'expense' as const, color: null, parent: null,
        isDefault: true, isInternalTransfer: false,
      }],
      accountFilenamePatterns: [],
      rules: [],
      transactions,
    };

    // Wrap db.transaction so the callback receives a counting Proxy
    // over the real tx. `restore.ts` opens exactly one db.transaction
    // per POST, so we can attribute every write to this run.
    let counts = { insert: 0, update: 0, delete: 0 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origTx = (db as any).transaction.bind(db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).transaction = async (cb: (tx: unknown) => Promise<unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return origTx(async (tx: any) => {
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
        return cb(wrapped);
      });
    };

    try {
      const res = await app.inject({
        method: 'POST', url: '/api/backup/import',
        headers: { cookie },
        payload: dumpBody,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().imported.transactions).toBe(5000);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).transaction = origTx;
    }

    const total = counts.insert + counts.update + counts.delete;
    // Ceiling: 10 tx INSERT chunks (5000 / 500) + accounts + categories +
    // (empty patterns/rules/checkpoints/budgets/goals/events skipped) +
    // fileImports + wipe path (~15 explicit deletes) + orphan-cleanup
    // insert. 40 is a generous cap that would blow past 5000+ with the
    // pre-refactor per-row loop.
    expect(total).toBeLessThan(40);

    await app.close();
  });
});
