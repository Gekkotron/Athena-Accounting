// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from './helpers/build-app.js';
import { seedUserAndCookie, seedAccount } from './helpers/seedUserAndCookie.js';
import { db } from '../src/db/client.js';
import { notifications, bankConnections, bankConnectionAccounts } from '../src/db/schema.js';
import { syncUserConnections } from '../src/domain/imports/bank-sync.js';
import type { EnableBankingClient } from '../src/services/enable-banking/client.js';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

d('notification triggers', () => {
  it('inserting a transaction above threshold queues a big_transaction batch', async () => {
    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { cookie },
      payload: { notifications: { triggers: { bigTransaction: { enabled: true, thresholds: { [String(accountId)]: 500 } } } } },
    });

    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { cookie },
      payload: { accountId, amount: '-800.00', date: '2026-09-01', rawLabel: 'Test Store' },
    });

    // Wait past IDLE_MS so the batcher flushes.
    await new Promise((r) => setTimeout(r, 2200));
    const rows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(rows.some((r) => r.kind === 'big_transaction')).toBe(true);

    await app.close();
  }, 10_000);

  it('a transaction that drops the balance below the floor emits account_low', async () => {
    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid, { openingBalance: '1000.00' });
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { cookie },
      payload: { notifications: { triggers: { accountLow: { enabled: true, floors: { [String(accountId)]: 500 } } } } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { cookie },
      payload: { accountId, amount: '-600.00', date: '2026-09-01', rawLabel: 'Big debit' },
    });
    expect(res.statusCode).toBe(201);

    const rows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(rows.some((r) => r.kind === 'account_low')).toBe(true);

    await app.close();
  });

  it('spending past a category envelope emits envelope_exceeded', async () => {
    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);

    const catRes = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: { cookie },
      payload: { name: 'Envelope test cat', kind: 'expense' },
    });
    const categoryId = catRes.json().category.id;

    await app.inject({
      method: 'POST',
      url: '/api/budgets',
      headers: { cookie },
      payload: { categoryId, monthlyLimit: '100.00' },
    });

    const today = new Date().toISOString().slice(0, 10);
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { cookie },
      payload: { accountId, amount: '-150.00', date: today, rawLabel: 'Envelope buster', categoryId },
    });
    expect(res.statusCode).toBe(201);

    const rows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(rows.some((r) => r.kind === 'envelope_exceeded')).toBe(true);

    await app.close();
  });

  it('a failed bank sync emits bank_sync_failed', async () => {
    const app = await buildApp();
    const { uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);

    const [conn] = await db
      .insert(bankConnections)
      .values({ userId: uid, sessionId: 'sess-fail', aspspName: 'Test Bank', validUntil: '2027-01-01' })
      .returning();
    await db.insert(bankConnectionAccounts).values({
      connectionId: conn!.id,
      bankAccountUid: 'uid-fail',
      accountId,
    });

    const failingClient = {
      getAllTransactions: async () => {
        throw new Error('bank unreachable');
      },
    } as unknown as EnableBankingClient;

    await syncUserConnections(uid, failingClient);

    const rows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(rows.some((r) => r.kind === 'bank_sync_failed')).toBe(true);

    await app.close();
  });
});
