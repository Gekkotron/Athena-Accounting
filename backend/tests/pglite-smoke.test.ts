// Smoke test for the PGlite driver path.
//
// Boots with DB_DRIVER=pglite on an empty in-memory DB, applies every
// Drizzle migration via runMigrations() (setup.ts triggers this when
// DB_DRIVER=pglite + RUN_DB_TESTS=1), then round-trips one insert + select
// against `users` and `transactions`. Guards against silent breakage from
// PGlite-incompatible SQL sneaking into a new migration.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';

const RUN = process.env.DB_DRIVER === 'pglite' && !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('PGlite driver smoke', () => {
  it('round-trips users and transactions after migrations apply', async () => {
    const { db } = await import('../src/db/client.js');
    const { users, accounts, transactions } = await import('../src/db/schema.js');

    const [u] = await db
      .insert(users)
      .values({ username: 'pglite-smoke', passwordHash: 'x' })
      .returning();
    expect(u?.id).toBeGreaterThan(0);

    const fetchedUsers = await db.select().from(users).where(eq(users.id, u!.id));
    expect(fetchedUsers).toHaveLength(1);
    expect(fetchedUsers[0]!.username).toBe('pglite-smoke');

    const [a] = await db
      .insert(accounts)
      .values({
        userId: u!.id,
        name: 'Smoke Account',
        type: 'checking',
        openingDate: '2025-01-01',
      })
      .returning();
    expect(a?.id).toBeGreaterThan(0);

    const [t] = await db
      .insert(transactions)
      .values({
        userId: u!.id,
        accountId: a!.id,
        date: '2025-01-15',
        amount: '-12.34',
        rawLabel: 'CB SMOKE TEST',
        normalizedLabel: 'cb smoke test',
        dedupKey: 'pglite-smoke-key',
      })
      .returning();
    expect(t?.id).toBeGreaterThan(0);

    const fetchedTx = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, t!.id));
    expect(fetchedTx).toHaveLength(1);
    expect(fetchedTx[0]!.amount).toBe('-12.34');
    expect(fetchedTx[0]!.normalizedLabel).toBe('cb smoke test');
  });
});
