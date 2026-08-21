// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

const RUN = !!process.env.RUN_DB_TESTS;

let userId: number;
let accountId: number;

async function seed(rows: Array<{ date: string; amount: string; rawLabel: string }>) {
  const { db } = await import('../../../../db/client.js');
  const { transactions } = await import('../../../../db/schema.js');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    await db.insert(transactions).values({
      userId, accountId,
      date: r.date, amount: r.amount,
      rawLabel: r.rawLabel,
      normalizedLabel: r.rawLabel.toLowerCase(),
      dedupKey: `hash:seed-${i}-${r.rawLabel}`,
      memo: null, fitid: null,
    });
  }
}

describe.skipIf(!RUN)('GET /api/transactions/duplicates (fuzzy)', () => {
  beforeAll(async () => {
    const { db } = await import('../../../../db/client.js');
    const { users, accounts } = await import('../../../../db/schema.js');
    const [u] = await db.insert(users).values({
      username: 'duplicates-fuzzy-user', passwordHash: 'x',
    }).returning();
    userId = u!.id;
    const [a] = await db.insert(accounts).values({
      userId, name: 'Fuzzy Panel', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountId = a!.id;
  });

  afterEach(async () => {
    const { db } = await import('../../../../db/client.js');
    const { transactions } = await import('../../../../db/schema.js');
    await db.delete(transactions);
  });

  it('hides groups whose labels are token-disjoint even at exact (date, amount)', async () => {
    await seed([
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'CB CARREFOUR MARKET' },
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'SNCF PARIS LYON' },
    ]);
    const { getDuplicates } = await import('../duplicates.js');
    const result = await getDuplicates({ userId });
    expect(result.groups).toHaveLength(0);
  });

  it('surfaces groups with Jaccard-similar labels', async () => {
    await seed([
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'CARREFOUR MARKET PARIS' },
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'CB CARREFOUR MARKET PARIS' },
    ]);
    const { getDuplicates } = await import('../duplicates.js');
    const result = await getDuplicates({ userId });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.transactions).toHaveLength(2);
  });

  it('surfaces near-duplicates within Δdate=2 / Δamount=0.01', async () => {
    await seed([
      { date: '2026-06-15', amount: '-25.30', rawLabel: 'CARREFOUR MARKET' },
      { date: '2026-06-17', amount: '-25.31', rawLabel: 'CARREFOUR MARKET REF-98' },
    ]);
    const { getDuplicates } = await import('../duplicates.js');
    const result = await getDuplicates({ userId });
    expect(result.groups).toHaveLength(1);
  });

  it('excludes rows with transfer_group_id set', async () => {
    const { db } = await import('../../../../db/client.js');
    const { transactions } = await import('../../../../db/schema.js');
    await db.insert(transactions).values([
      {
        userId, accountId, date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CARREFOUR', normalizedLabel: 'carrefour',
        dedupKey: 'hash:xfer-1', memo: null, fitid: null,
        transferGroupId: 'legacy-group',
      },
      {
        userId, accountId, date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CARREFOUR PARIS', normalizedLabel: 'carrefour paris',
        dedupKey: 'hash:xfer-2', memo: null, fitid: null,
      },
    ]);
    const { getDuplicates } = await import('../duplicates.js');
    const result = await getDuplicates({ userId });
    expect(result.groups).toHaveLength(0);
  });
});
