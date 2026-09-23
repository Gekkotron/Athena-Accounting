// Perf-audit regression guard for the batched split-emit path in
// recategorizeAll (2026-09-17 audit). Pre-refactor, N split-mode-matched
// parents cost N × db.transaction × 3 statements each (~600 round-trips
// for 200 parents). The batched version collapses the whole fan-out to
// 3 statements (bulk-DELETE + bulk-INSERT + VALUES-JOIN UPDATE) inside
// one outer transaction. Requires RUN_DB_TESTS=1.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

d('recategorizeAll — batched split-emit path', () => {
  it('200 parents × 3 split-mode rules writes in ≤ 6 statements (spy the tx)', async () => {
    const { db } = await import('../src/db/client.js');
    const {
      categories, rules, ruleSplits, transactions, transactionSplits,
    } = await import('../src/db/schema.js');
    const { seedUser } = await import('./helpers/seedUser.js');
    const { recategorizeAll } = await import('../src/domain/rules/recategorize.js');

    const uid = await seedUser();
    // Seed a fresh account.
    const { accounts } = await import('../src/db/schema.js');
    const [acct] = await db.insert(accounts).values({
      userId: uid,
      name: `bulk-acct-${Date.now()}`,
      type: 'checking',
      currency: 'EUR',
      openingBalance: '0',
      openingDate: '2025-01-01',
    }).returning();
    const accountId = acct!.id;

    // 1 parent + 6 children for 3 (60/40) split targets.
    const catRows = await db.insert(categories).values([
      { userId: uid, name: 'Cat-A1', kind: 'expense', isDefault: false },
      { userId: uid, name: 'Cat-A2', kind: 'expense', isDefault: false },
      { userId: uid, name: 'Cat-B1', kind: 'expense', isDefault: false },
      { userId: uid, name: 'Cat-B2', kind: 'expense', isDefault: false },
      { userId: uid, name: 'Cat-C1', kind: 'expense', isDefault: false },
      { userId: uid, name: 'Cat-C2', kind: 'expense', isDefault: false },
      { userId: uid, name: 'Parent', kind: 'expense', isDefault: false },
    ]).returning();
    const [a1, a2, b1, b2, c1, c2, parent] = catRows.map((r) => r.id);

    // Three split-mode rules pointing at the parent category with 60/40 splits.
    const rulePairs: Array<[string, number, number]> = [
      ['label-a', a1!, a2!],
      ['label-b', b1!, b2!],
      ['label-c', c1!, c2!],
    ];
    const seededRules = await db.insert(rules).values(
      rulePairs.map(([keyword]) => ({
        userId: uid, categoryId: parent!, keyword,
        signConstraint: 'any' as const, matchMode: 'word' as const,
        priority: 100, enabled: true,
      })),
    ).returning({ id: rules.id });
    await db.insert(ruleSplits).values(
      seededRules.flatMap((r, i) => {
        const [, cx1, cx2] = rulePairs[i]!;
        return [
          { ruleId: r.id, categoryId: cx1, percent: 60, position: 0 },
          { ruleId: r.id, categoryId: cx2, percent: 40, position: 1 },
        ];
      }),
    );

    // 200 transactions across the 3 labels, non-zero amounts so the parents
    // survive computeSplitCents's zero-amount short-circuit.
    const txValues: Array<Parameters<typeof db.insert>[0] extends never ? never : object> = [];
    for (let i = 0; i < 200; i++) {
      const label = rulePairs[i % 3]![0];
      txValues.push({
        userId: uid, accountId,
        date: '2026-08-15', amount: `-${(10 + i).toFixed(2)}`,
        rawLabel: label.toUpperCase(),
        normalizedLabel: label,
        dedupKey: `recat-split-${label}-${i}`,
        categorySource: 'default' as const,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(transactions).values(txValues as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origTx = (db as any).transaction.bind(db);
    const counts = { insert: 0, update: 0, delete: 0, execute: 0 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).transaction = async (cb: (tx: any) => Promise<unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return origTx(async (tx: any) => {
        const wrapped = new Proxy(tx, {
          get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (prop === 'insert' || prop === 'update' || prop === 'delete' || prop === 'execute') {
              return (...args: unknown[]) => {
                counts[prop as keyof typeof counts]++;
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
    let result;
    try {
      result = await recategorizeAll({ userId: uid, preserveManual: true });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).transaction = origTx;
    }

    expect(result.splitsEmitted).toBe(200);
    // 3 phases inside one outer tx: 1 DELETE (batch ≤ 500), 1 INSERT
    // (400 split rows ≤ 500), 1 UPDATE-via-execute (200 parents ≤ 500).
    // Pre-refactor: 200 outer transactions × 3 statements = 600+ writes.
    const total = counts.insert + counts.update + counts.delete + counts.execute;
    expect(total).toBeLessThanOrEqual(6);

    // Sanity: every parent has 2 splits totaling its parent amount.
    const [firstTx] = await db
      .select({ id: transactions.id, amount: transactions.amount, splitsSource: transactions.splitsSource })
      .from(transactions)
      .where(eq(transactions.normalizedLabel, 'label-a'))
      .limit(1);
    const splits = await db
      .select({ amount: transactionSplits.amount })
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, firstTx!.id));
    expect(splits).toHaveLength(2);
    const sum = splits.reduce((acc, s) => acc + Number(s.amount), 0);
    expect(Math.abs(sum - Number(firstTx!.amount))).toBeLessThan(0.005);
    expect(firstTx!.splitsSource).toBe('auto');
  });
});
