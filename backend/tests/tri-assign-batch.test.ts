// Perf-audit regression guards for the batched /api/tri/assign
// (2026-09-11 audit). Pre-refactor the handler ran ~2 statements per
// group with no transaction — a mid-batch failure left users in a
// split state. The batched version wraps the write path in
// db.transaction and collapses to ≤ 2 statements: one UPDATE ...
// FROM (VALUES ...) for every (label → category) assignment, and one
// multi-values INSERT for the rules (when createRules is on).
// Requires RUN_DB_TESTS=1.
import { describe, it, expect } from 'vitest';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

async function seedTx(uid: number, accountId: number, normalizedLabel: string, i: number) {
  const { db } = await import('../src/db/client.js');
  const { transactions } = await import('../src/db/schema.js');
  await db.insert(transactions).values({
    userId: uid, accountId,
    date: '2026-06-15', amount: '-1.00',
    rawLabel: normalizedLabel.toUpperCase(),
    normalizedLabel,
    dedupKey: `tri-${normalizedLabel}-${i}`,
    categorySource: 'default',
  });
}

d('POST /api/tri/assign — batched write path', () => {
  it('rejects an empty groups array via zod (400)', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie } = await import('./helpers/seedUserAndCookie.js');
    const app = await buildApp();
    const { cookie } = await seedUserAndCookie(app);
    const res = await app.inject({
      method: 'POST', url: '/api/tri/assign',
      headers: { cookie },
      payload: { groups: [] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('single-group payload assigns + creates one rule', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie, seedAccount } = await import('./helpers/seedUserAndCookie.js');
    const { db } = await import('../src/db/client.js');
    const { categories, rules } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);
    const [cat] = await db.insert(categories).values({
      userId: uid, name: 'CafeCat', kind: 'expense', isDefault: false,
    }).returning();
    await seedTx(uid, accountId, 'boulangerie-du-coin', 0);
    await seedTx(uid, accountId, 'boulangerie-du-coin', 1);

    const res = await app.inject({
      method: 'POST', url: '/api/tri/assign',
      headers: { cookie },
      payload: {
        groups: [{ normalizedLabel: 'boulangerie-du-coin', categoryId: cat!.id }],
        createRules: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ assigned: 2, rulesCreated: 1 });

    const ruleRows = await db.select().from(rules).where(eq(rules.userId, uid));
    expect(ruleRows.length).toBe(1);
    expect(ruleRows[0]!.categoryId).toBe(cat!.id);
    expect(ruleRows[0]!.signConstraint).toBe('negative'); // expense category
    await app.close();
  });

  it('100-group payload writes in ≤ 3 statements (spy the tx)', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie, seedAccount } = await import('./helpers/seedUserAndCookie.js');
    const { db } = await import('../src/db/client.js');
    const { categories } = await import('../src/db/schema.js');
    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);
    const [cat] = await db.insert(categories).values({
      userId: uid, name: 'Bulk', kind: 'expense', isDefault: false,
    }).returning();
    // Seed 100 to-be-categorised transactions with distinct normalized labels.
    for (let i = 0; i < 100; i++) await seedTx(uid, accountId, `label-${i}`, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origTx = (db as any).transaction.bind(db);
    let counts = { insert: 0, update: 0, delete: 0, execute: 0 };
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
    try {
      const res = await app.inject({
        method: 'POST', url: '/api/tri/assign',
        headers: { cookie },
        payload: {
          groups: Array.from({ length: 100 }, (_, i) => ({
            normalizedLabel: `label-${i}`,
            categoryId: cat!.id,
          })),
          createRules: true,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().assigned).toBe(100);
      expect(res.json().rulesCreated).toBe(100);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).transaction = origTx;
    }
    // Batched path is 1 UPDATE (via tx.execute) + 1 INSERT (rules) = 2 writes.
    const total = counts.insert + counts.update + counts.delete + counts.execute;
    expect(total).toBeLessThanOrEqual(3);
    await app.close();
  });

  it('mid-batch failure rolls back the UPDATE (transactional atomicity)', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie, seedAccount } = await import('./helpers/seedUserAndCookie.js');
    const { db } = await import('../src/db/client.js');
    const { categories, transactions } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);
    const [cat] = await db.insert(categories).values({
      userId: uid, name: 'RollbackCat', kind: 'expense', isDefault: false,
    }).returning();
    await seedTx(uid, accountId, 'rollback-me', 0);
    await seedTx(uid, accountId, 'rollback-me', 1);

    // Inject a failure inside the transaction: monkey-patch db.transaction
    // to throw AFTER the UPDATE runs but BEFORE the callback returns.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origTx = (db as any).transaction.bind(db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).transaction = async (cb: (tx: any) => Promise<unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return origTx(async (tx: any) => {
        const wrapped = new Proxy(tx, {
          get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (prop === 'insert') {
              return (..._args: unknown[]) => {
                throw new Error('boom: injected mid-batch failure');
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
        method: 'POST', url: '/api/tri/assign',
        headers: { cookie },
        payload: {
          groups: [{ normalizedLabel: 'rollback-me', categoryId: cat!.id }],
          createRules: true,
        },
      });
      expect(res.statusCode).toBe(500);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).transaction = origTx;
    }

    // Both transactions must STILL be uncategorised — the UPDATE was rolled back.
    const rows = await db.select().from(transactions).where(eq(transactions.userId, uid));
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.categoryId).toBeNull();
      expect(r.categorySource).toBe('default');
    }
    await app.close();
  });
});
