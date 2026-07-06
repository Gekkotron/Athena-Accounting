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

  describe('splits routes', () => {
    it('GET /:id/splits returns [] when the transaction has no splits', async () => {
      const txId = await makeTx({
        accountId, date: '2026-06-17', amount: '-50.00', rawLabel: 'Foo',
      });
      const res = await app.inject({
        method: 'GET', url: `/api/transactions/${txId}/splits`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().splits).toEqual([]);
    });

    it('PUT /:id/splits with a matching sum inserts them and returns the persisted rows', async () => {
      const txId = await makeTx({
        accountId, date: '2026-06-18', amount: '-100.00', rawLabel: 'Amazon',
      });
      const res = await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`,
        headers: { cookie },
        payload: {
          splits: [
            { categoryId: categoryBooksId,   amount: '-60.00', memo: 'Kindle' },
            { categoryId: categoryElectroId, amount: '-30.00' },
            { categoryId: categoryDiversId,  amount: '-10.00' },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const splits = res.json().splits;
      expect(splits).toHaveLength(3);
      expect(splits[0]).toMatchObject({
        transactionId: txId, categoryId: categoryBooksId, amount: '-60.00', memo: 'Kindle',
      });
      expect(splits.every((s: { id: number }) => Number.isInteger(s.id))).toBe(true);
    });

    it('PUT with sum != parent amount → 400 and no rows written', async () => {
      const txId = await makeTx({
        accountId, date: '2026-06-19', amount: '-100.00', rawLabel: 'Amazon',
      });
      const bad = await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`,
        headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId, amount: '-40.00' },
          { categoryId: categoryElectroId, amount: '-30.00' },
        ] },
      });
      expect(bad.statusCode).toBe(400);
      const after = await app.inject({
        method: 'GET', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      });
      expect(after.json().splits).toEqual([]);
    });

    it('PUT replaces an existing set atomically', async () => {
      const txId = await makeTx({
        accountId, date: '2026-06-20', amount: '-100.00', rawLabel: 'Amazon',
      });
      await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId,   amount: '-70.00' },
          { categoryId: categoryElectroId, amount: '-30.00' },
        ] },
      });
      const second = await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId,  amount: '-50.00' },
          { categoryId: categoryDiversId, amount: '-50.00' },
        ] },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().splits).toHaveLength(2);
      expect(second.json().splits.map((s: { categoryId: number }) => s.categoryId))
        .toEqual([categoryBooksId, categoryDiversId]);
    });

    it('PUT with mixed signs on a negative parent → 400', async () => {
      const txId = await makeTx({
        accountId, date: '2026-06-21', amount: '-100.00', rawLabel: 'Amazon',
      });
      const bad = await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId,   amount: '-150.00' },
          { categoryId: categoryElectroId, amount:  '50.00' },  // wrong sign
        ] },
      });
      expect(bad.statusCode).toBe(400);
    });

    it('PUT with negative split on a positive parent → 400', async () => {
      const txId = await makeTx({
        accountId, date: '2026-07-07', amount: '100.00', rawLabel: 'refund',
      });
      const bad = await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId,   amount: '150.00' },
          { categoryId: categoryElectroId, amount: '-50.00' },
        ] },
      });
      expect(bad.statusCode).toBe(400);
    });

    it('PUT with 1 split → 400 (min 2)', async () => {
      const txId = await makeTx({
        accountId, date: '2026-06-22', amount: '-50.00', rawLabel: 'x',
      });
      const bad = await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [{ categoryId: categoryBooksId, amount: '-50.00' }] },
      });
      expect(bad.statusCode).toBe(400);
    });

    it('PUT with 21 splits → 400 (max bound)', async () => {
      const txId = await makeTx({
        accountId, date: '2026-07-05', amount: '-105.00', rawLabel: 'many-splits',
      });
      const bad = await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: {
          splits: Array.from({ length: 21 }, () => ({
            categoryId: categoryBooksId, amount: '-5.00',
          })),
        },
      });
      expect(bad.statusCode).toBe(400);
    });

    it('PUT on a transfer leg → 400', async () => {
      // Create an internal transfer via a matched pair of transactions.
      // Simplest way: manually stamp transferGroupId on a newly-created tx via db update.
      const txId = await makeTx({
        accountId, date: '2026-06-30', amount: '-50.00', rawLabel: 'transfer-out',
      });
      const { db } = await import('../src/db/client.js');
      const { transactions } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      await db.update(transactions)
        .set({ transferGroupId: '00000000-0000-0000-0000-000000000001' })
        .where(eq(transactions.id, txId));
      const bad = await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId, amount: '-30.00' },
          { categoryId: categoryElectroId, amount: '-20.00' },
        ] },
      });
      expect(bad.statusCode).toBe(400);
    });

    it('PUT referencing another user\'s category → 400', async () => {
      // Create a second user and a category owned by them.
      await app.inject({
        method: 'POST', url: '/api/onboarding/create',
        payload: { username: 'other', password: 'other-user-1234' },
      });
      const otherLogin = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'other', password: 'other-user-1234' },
      });
      const otherCookie = otherLogin.cookies[0]!.name + '=' + otherLogin.cookies[0]!.value;
      const foreignCat = await app.inject({
        method: 'POST', url: '/api/categories', headers: { cookie: otherCookie },
        payload: { name: 'ForeignBooks', kind: 'expense' },
      });
      const foreignCatId = foreignCat.json().category.id;

      const txId = await makeTx({
        accountId, date: '2026-06-23', amount: '-100.00', rawLabel: 'Amazon',
      });
      const bad = await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: foreignCatId,     amount: '-60.00' },
          { categoryId: categoryElectroId, amount: '-40.00' },
        ] },
      });
      expect(bad.statusCode).toBe(400);
    });

    it('PUT on a zero-amount parent → 400', async () => {
      const txId = await makeTx({
        accountId, date: '2026-06-24', amount: '0.00', rawLabel: 'noop',
      });
      const bad = await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId,   amount: '0.00' },
          { categoryId: categoryElectroId, amount: '0.00' },
        ] },
      });
      expect(bad.statusCode).toBe(400);
    });

    it('DELETE clears splits and restores parent-category-authority', async () => {
      const txId = await makeTx({
        accountId, date: '2026-06-25', amount: '-100.00', rawLabel: 'Amazon',
        categoryId: categoryBooksId,
      });
      await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryElectroId, amount: '-60.00' },
          { categoryId: categoryDiversId,  amount: '-40.00' },
        ] },
      });
      const del = await app.inject({
        method: 'DELETE', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      });
      expect(del.statusCode).toBe(200);
      expect(del.json().deleted).toBe(2);
      const after = await app.inject({
        method: 'GET', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      });
      expect(after.json().splits).toEqual([]);
    });

    it('deleting a category referenced by a split → split survives with categoryId null', async () => {
      const txId = await makeTx({
        accountId, date: '2026-07-06', amount: '-100.00', rawLabel: 'Amazon',
      });
      const ephemeralCatRes = await app.inject({
        method: 'POST', url: '/api/categories', headers: { cookie },
        payload: { name: 'EphemeralSplitCat', kind: 'expense' },
      });
      const ephemeralCatId = ephemeralCatRes.json().category.id;
      await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: ephemeralCatId,  amount: '-60.00' },
          { categoryId: categoryDiversId, amount: '-40.00' },
        ] },
      });
      const del = await app.inject({
        method: 'DELETE', url: `/api/categories/${ephemeralCatId}`, headers: { cookie },
      });
      expect(del.statusCode).toBeLessThan(400);
      const single = await app.inject({
        method: 'GET', url: `/api/transactions/${txId}`, headers: { cookie },
      });
      const splits = single.json().transaction.splits as Array<{ categoryId: number | null; amount: string }>;
      expect(splits).toHaveLength(2);
      const survivor = splits.find((s) => s.amount === '-60.00')!;
      expect(survivor.categoryId).toBeNull();
    });

    it('deleting the parent transaction cascades to splits', async () => {
      const txId = await makeTx({
        accountId, date: '2026-06-26', amount: '-100.00', rawLabel: 'Amazon',
      });
      await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId,   amount: '-60.00' },
          { categoryId: categoryElectroId, amount: '-40.00' },
        ] },
      });
      await app.inject({
        method: 'DELETE', url: `/api/transactions/${txId}`, headers: { cookie },
      });
      const { db } = await import('../src/db/client.js');
      const { transactionSplits } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, txId));
      expect(rows).toHaveLength(0);
    });

    it('GET /api/transactions hydrates splits: [] and the split rows', async () => {
      const txIdPlain = await makeTx({
        accountId, date: '2026-06-27', amount: '-25.00', rawLabel: 'coffee',
      });
      const txIdSplit = await makeTx({
        accountId, date: '2026-06-27', amount: '-100.00', rawLabel: 'Amazon',
      });
      await app.inject({
        method: 'PUT', url: `/api/transactions/${txIdSplit}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId,   amount: '-60.00' },
          { categoryId: categoryElectroId, amount: '-40.00' },
        ] },
      });
      const list = await app.inject({
        method: 'GET',
        url: `/api/transactions?accountId=${accountId}&fromDate=2026-06-27&toDate=2026-06-27`,
        headers: { cookie },
      });
      expect(list.statusCode).toBe(200);
      const txns = list.json().transactions as Array<{ id: number; splits: unknown[] }>;
      const plain = txns.find((t) => t.id === txIdPlain)!;
      const split = txns.find((t) => t.id === txIdSplit)!;
      expect(plain.splits).toEqual([]);
      expect(split.splits).toHaveLength(2);
      expect(split.splits[0]).toMatchObject({
        transactionId: txIdSplit, categoryId: categoryBooksId, amount: '-60.00',
      });

      const single = await app.inject({
        method: 'GET', url: `/api/transactions/${txIdSplit}`, headers: { cookie },
      });
      expect(single.json().transaction.splits).toHaveLength(2);

      // Empty-splits case on the single-row endpoint too — locks the
      // hydrateSplits([row]) empty-array branch in.
      const singlePlain = await app.inject({
        method: 'GET', url: `/api/transactions/${txIdPlain}`, headers: { cookie },
      });
      expect(singlePlain.json().transaction.splits).toEqual([]);
    });

    it('PATCH amount on a split transaction → 409, no changes applied', async () => {
      const txId = await makeTx({
        accountId, date: '2026-06-28', amount: '-100.00', rawLabel: 'Amazon',
      });
      await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId,  amount: '-60.00' },
          { categoryId: categoryDiversId, amount: '-40.00' },
        ] },
      });
      const bad = await app.inject({
        method: 'PATCH', url: `/api/transactions/${txId}`, headers: { cookie },
        payload: { amount: '-200.00' },
      });
      expect(bad.statusCode).toBe(409);
      const after = await app.inject({
        method: 'GET', url: `/api/transactions/${txId}`, headers: { cookie },
      });
      expect(after.json().transaction.amount).toBe('-100.00');
    });

    it('PATCH notes on a split transaction still succeeds (no trigger involvement)', async () => {
      const txId = await makeTx({
        accountId, date: '2026-06-29', amount: '-100.00', rawLabel: 'Amazon',
      });
      await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId,  amount: '-60.00' },
          { categoryId: categoryDiversId, amount: '-40.00' },
        ] },
      });
      const ok = await app.inject({
        method: 'PATCH', url: `/api/transactions/${txId}`, headers: { cookie },
        payload: { notes: 'kindle + livraison' },
      });
      expect(ok.statusCode).toBe(200);
    });

    it('GET /api/transactions?categoryId=X includes split-only matches', async () => {
      const plainTx = await makeTx({
        accountId, date: '2026-07-01', amount: '-40.00', rawLabel: 'plain Livres',
        categoryId: categoryBooksId,
      });
      const splitTx = await makeTx({
        accountId, date: '2026-07-02', amount: '-100.00', rawLabel: 'Amazon',
      });
      await app.inject({
        method: 'PUT', url: `/api/transactions/${splitTx}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId: categoryBooksId,   amount: '-60.00' },
          { categoryId: categoryElectroId, amount: '-40.00' },
        ] },
      });

      const list = await app.inject({
        method: 'GET',
        url: `/api/transactions?categoryId=${categoryBooksId}`,
        headers: { cookie },
      });
      expect(list.statusCode).toBe(200);
      const ids = (list.json().transactions as Array<{ id: number }>).map((t) => t.id).sort();
      expect(ids).toEqual([plainTx, splitTx].sort());
    });

    it('GET / PUT / DELETE unauthenticated → 401', async () => {
      for (const method of ['GET', 'PUT', 'DELETE'] as const) {
        const res = await app.inject({
          method, url: `/api/transactions/1/splits`,
          ...(method === 'PUT' ? { payload: { splits: [] } } : {}),
        });
        expect(res.statusCode).toBe(401);
      }
    });
  });
});
