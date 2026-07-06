// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountId: number;
let categoryBooksId: number;
let categoryElectroId: number;
let categoryDiversId: number;
let transferAccountId: number;

async function makeTx(payload: Record<string, unknown>): Promise<number> {
  const res = await app.inject({
    method: 'POST', url: '/api/transactions',
    headers: { cookie }, payload,
  });
  if (res.statusCode !== 201) {
    throw new Error(`expected 201 got ${res.statusCode}: ${res.body}`);
  }
  return res.json().transaction.id;
}

describe.skipIf(!RUN)('transaction_splits DB layer', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'splits', password: 'splits-test-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'splits', password: 'splits-test-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const acc = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'Compte', type: 'current', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    accountId = acc.json().account.id;
    const acc2 = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: { name: 'Compte2', type: 'current', currency: 'EUR', openingBalance: '0', openingDate: '2025-01-01' },
    });
    transferAccountId = acc2.json().account.id;

    const mkCat = async (name: string, kind: string) => {
      const c = await app.inject({
        method: 'POST', url: '/api/categories', headers: { cookie },
        payload: { name, kind },
      });
      return c.json().category.id as number;
    };
    categoryBooksId   = await mkCat('Livres',  'expense');
    categoryElectroId = await mkCat('Électro', 'expense');
    categoryDiversId  = await mkCat('DiversTx', 'neutral');
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { transactionSplits, transactions } = await import('../src/db/schema.js');
    await db.delete(transactionSplits);
    await db.delete(transactions);
  });

  it('table + triggers installed by migration 0014', async () => {
    const { db } = await import('../src/db/client.js');
    const { sql } = await import('drizzle-orm');
    const rows = await db.execute<{ tgname: string }>(sql`
      SELECT tgname FROM pg_trigger
       WHERE tgname IN ('transaction_splits_checksum_trg',
                        'transactions_amount_lock_when_split_trg')
       ORDER BY tgname
    `);
    expect(rows.rows.map((r) => r.tgname)).toEqual([
      'transaction_splits_checksum_trg',
      'transactions_amount_lock_when_split_trg',
    ]);
  });

  it('checksum trigger rejects a split-sum mismatch at COMMIT', async () => {
    const { db } = await import('../src/db/client.js');
    const { sql } = await import('drizzle-orm');
    const txId = await makeTx({
      accountId, date: '2026-06-15', amount: '-100.00',
      rawLabel: 'Amazon FR',
    });
    await expect(
      db.execute(sql`
        INSERT INTO transaction_splits (transaction_id, category_id, amount)
        VALUES (${txId}, ${categoryBooksId}, '-40.00'),
               (${txId}, ${categoryElectroId}, '-30.00')
      `),
    ).rejects.toThrow(/sum mismatch/);
  });

  it('amount-lock trigger rejects UPDATE of parent.amount while splits exist', async () => {
    const { db } = await import('../src/db/client.js');
    const { sql } = await import('drizzle-orm');
    const txId = await makeTx({
      accountId, date: '2026-06-16', amount: '-100.00',
      rawLabel: 'Amazon FR',
    });
    await db.execute(sql`
      INSERT INTO transaction_splits (transaction_id, category_id, amount)
      VALUES (${txId}, ${categoryBooksId},   '-60.00'),
             (${txId}, ${categoryElectroId}, '-30.00'),
             (${txId}, ${categoryDiversId},  '-10.00')
    `);
    await expect(
      db.execute(sql`UPDATE transactions SET amount = '-200.00' WHERE id = ${txId}`),
    ).rejects.toThrow(/cannot change transaction amount/);
  });
});
