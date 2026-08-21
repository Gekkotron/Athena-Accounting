// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

const RUN = !!process.env.RUN_DB_TESTS;

let userId: number;
let accountA: number;
let accountB: number;

describe.skipIf(!RUN)('findFuzzyMatches', () => {
  beforeAll(async () => {
    const { db } = await import('../../../db/client.js');
    const { users, accounts } = await import('../../../db/schema.js');
    const [u] = await db.insert(users).values({
      username: 'fuzzy-match-user', passwordHash: 'x',
    }).returning();
    userId = u!.id;
    const [a] = await db.insert(accounts).values({
      userId, name: 'Fuzzy A', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountA = a!.id;
    const [b] = await db.insert(accounts).values({
      userId, name: 'Fuzzy B', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountB = b!.id;
  });

  afterEach(async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.delete(transactions);
  });

  it('surfaces same-account fuzzy matches inside the date/amount window', async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.insert(transactions).values({
      userId, accountId: accountA,
      date: '2026-06-15', amount: '-25.30',
      rawLabel: 'CB CARREFOUR MARKET',
      normalizedLabel: 'carrefour market',
      dedupKey: 'hash:seed-1', memo: null, fitid: null,
    });
    const { findFuzzyMatches } = await import('../fuzzy-match.js');
    const result = await findFuzzyMatches({
      accountId: accountA, userId,
      incoming: [
        {
          date: '2026-06-17', amount: '-25.31',
          rawLabel: 'PAIEMENT CARREFOUR MARKET REF-98',
          normalizedLabel: 'carrefour market',
        },
      ],
    });
    expect(result.size).toBe(1);
    const matches = result.get(0)!;
    expect(matches.length).toBe(1);
    expect(matches[0]!.jaccard).toBeGreaterThanOrEqual(0.5);
    expect(matches[0]!.candidate.txId).toBeTruthy();
  });

  it('excludes rows on a different account', async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.insert(transactions).values({
      userId, accountId: accountB,
      date: '2026-06-15', amount: '-25.30',
      rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour',
      dedupKey: 'hash:seed-2', memo: null, fitid: null,
    });
    const { findFuzzyMatches } = await import('../fuzzy-match.js');
    const result = await findFuzzyMatches({
      accountId: accountA, userId,
      incoming: [{
        date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour',
      }],
    });
    expect(result.size).toBe(0);
  });

  it('excludes rows with transfer_group_id set', async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.insert(transactions).values({
      userId, accountId: accountA,
      date: '2026-06-15', amount: '-25.30',
      rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour',
      dedupKey: 'hash:seed-3', memo: null, fitid: null,
      transferGroupId: 'legacy-group',
    });
    const { findFuzzyMatches } = await import('../fuzzy-match.js');
    const result = await findFuzzyMatches({
      accountId: accountA, userId,
      incoming: [{
        date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour',
      }],
    });
    expect(result.size).toBe(0);
  });

  it('sorts multiple candidates by Jaccard descending', async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.insert(transactions).values([
      {
        userId, accountId: accountA,
        date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CARREFOUR MARKET PARIS', normalizedLabel: 'carrefour market paris',
        dedupKey: 'hash:multi-1', memo: null, fitid: null,
      },
      {
        userId, accountId: accountA,
        date: '2026-06-16', amount: '-25.30',
        rawLabel: 'CARREFOUR PARIS', normalizedLabel: 'carrefour paris',
        dedupKey: 'hash:multi-2', memo: null, fitid: null,
      },
    ]);
    const { findFuzzyMatches } = await import('../fuzzy-match.js');
    const result = await findFuzzyMatches({
      accountId: accountA, userId,
      incoming: [{
        date: '2026-06-15', amount: '-25.30',
        rawLabel: 'CARREFOUR MARKET PARIS',
        normalizedLabel: 'carrefour market paris',
      }],
    });
    const matches = result.get(0)!;
    expect(matches.length).toBe(2);
    expect(matches[0]!.jaccard).toBeGreaterThanOrEqual(matches[1]!.jaccard);
  });
});
