// requires Postgres — run with RUN_DB_TESTS=1
//
// Isolated in its own file because it replaces emit.js's emitNotification
// with a throwing stub for the whole module graph — mixing that into
// notifications-triggers.test.ts would break every other case there that
// expects a real notification to land.
import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

vi.mock('../src/domain/notifications/emit.js', () => ({
  emitNotification: vi.fn(async () => {
    throw new Error('boom: emitNotification unavailable');
  }),
}));

d('notification hooks — best effort', () => {
  it('a hook failure never blocks the transaction insert (201, row persisted, no notification)', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie, seedAccount } = await import('./helpers/seedUserAndCookie.js');
    const { db } = await import('../src/db/client.js');
    const { notifications, transactions } = await import('../src/db/schema.js');

    const app = await buildApp();
    const { cookie, uid } = await seedUserAndCookie(app);
    const accountId = await seedAccount(uid, { openingBalance: '1000.00' });

    // A floor that WOULD fire account_low — the check must run into the
    // mocked, throwing emitNotification, and the hook must swallow it.
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
      payload: { accountId, amount: '-600.00', date: '2026-09-01', rawLabel: 'Should still succeed' },
    });

    // (a) the primary outcome is unaffected by the hook failure.
    expect(res.statusCode).toBe(201);
    const txId = res.json().transaction.id;

    // (b) the transaction row is really there.
    const [row] = await db.select().from(transactions).where(eq(transactions.id, txId));
    expect(row).toBeTruthy();

    // (c) no notification was created — emitNotification threw before it
    // could insert anything, and the hook swallowed that error.
    const notifRows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(notifRows).toHaveLength(0);

    await app.close();
  });
});
