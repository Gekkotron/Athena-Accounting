// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from './helpers/build-app.js';
import { seedUserAndCookie, seedAccount } from './helpers/seedUserAndCookie.js';
import { seedUser } from './helpers/seedUser.js';
import { db } from '../src/db/client.js';
import { notifications, bankConnections, bankConnectionAccounts, transactions } from '../src/db/schema.js';
import { syncUserConnections } from '../src/domain/imports/bank-sync.js';
import { computeCurrentBalance } from '../src/domain/notifications/hooks.js';
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

  it('prefers the account-scoped budget over a global budget for the same category', async () => {
    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid);

    const catRes = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: { cookie },
      payload: { name: 'Scoped envelope cat', kind: 'expense' },
    });
    const categoryId = catRes.json().category.id;

    // Global budget: high limit, would NOT be exceeded by this spend.
    await app.inject({
      method: 'POST',
      url: '/api/budgets',
      headers: { cookie },
      payload: { categoryId, monthlyLimit: '1000.00' },
    });
    // Account-scoped budget for the same category: low limit, WOULD be exceeded.
    await app.inject({
      method: 'POST',
      url: '/api/budgets',
      headers: { cookie },
      payload: { categoryId, monthlyLimit: '100.00', accountId },
    });

    const today = new Date().toISOString().slice(0, 10);
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { cookie },
      payload: { accountId, amount: '-150.00', date: today, rawLabel: 'Scoped envelope buster', categoryId },
    });
    expect(res.statusCode).toBe(201);

    const rows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    const envelopeRow = rows.find((r) => r.kind === 'envelope_exceeded');
    expect(envelopeRow).toBeTruthy();
    const payload = envelopeRow!.payload as { envelope: number; spent: number };
    // 100, not 1000 — the account-scoped budget won, not the global one.
    expect(payload.envelope).toBe(100);
    expect(payload.spent).toBe(150);

    await app.close();
  });

  it('computeCurrentBalance is scoped to the owning user (no cross-tenant balance leak)', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const accountB = await seedAccount(userB, { openingBalance: '5000.00' });

    // userA has no relationship to accountB — must not see userB's balance.
    const balance = await computeCurrentBalance(userA, accountB);
    expect(balance).toBe(0);
  });

  it('rejects a transaction posted against another user\'s account (IDOR)', async () => {
    const app = await buildApp();
    const { cookie: cookieA } = await seedUserAndCookie(app);
    const userB = await seedUser();
    const accountB = await seedAccount(userB);

    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: { cookie: cookieA },
      payload: { accountId: accountB, amount: '-10.00', date: '2026-09-01', rawLabel: 'Cross-tenant attempt' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);

    const rows = await db.select().from(transactions).where(eq(transactions.accountId, accountB));
    expect(rows).toHaveLength(0);

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
