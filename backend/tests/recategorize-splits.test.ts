// End-to-end coverage of the split-mode branch of the rule engine.
// PGlite-gated — runs under RUN_DB_TESTS=1 with DB_DRIVER=pglite.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let uid: number;
let accountId: number;
let primaryCatId: number;
let splitA: number;
let splitB: number;
let defaultCatId: number;

async function createRule(payload: {
  keyword: string;
  categoryId: number;
  splits?: Array<{ categoryId: number; percent: number }>;
}): Promise<number> {
  const res = await app.inject({
    method: 'POST', url: '/api/rules', headers: { cookie }, payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().rule.id;
}

async function seedTransaction(amount: number, label: string): Promise<number> {
  const res = await app.inject({
    method: 'POST', url: '/api/transactions', headers: { cookie },
    payload: {
      accountId,
      date: '2026-06-15',
      amount: amount.toFixed(2),
      rawLabel: label,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().transaction.id;
}

async function fetchSplits(txId: number) {
  const { db } = await import('../src/db/client.js');
  const { transactionSplits } = await import('../src/db/schema.js');
  return db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, txId));
}

async function fetchTx(txId: number) {
  const { db } = await import('../src/db/client.js');
  const { transactions } = await import('../src/db/schema.js');
  const [row] = await db.select().from(transactions).where(eq(transactions.id, txId));
  return row!;
}

describe.skipIf(!RUN)('recategorize with split-mode rules', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();

    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'recat-splits-user', password: 'recat-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'recat-splits-user', password: 'recat-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const me = await app.inject({
      method: 'GET', url: '/api/auth/me', headers: { cookie },
    });
    uid = me.json().user.id;

    const acc = await app.inject({
      method: 'POST', url: '/api/accounts', headers: { cookie },
      payload: {
        name: 'Compte courant',
        type: 'checking',
        currency: 'EUR',
        openingBalance: '0',
        openingDate: '2026-01-01',
      },
    });
    accountId = acc.json().account.id;

    const primary = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Retail', kind: 'expense' },
    });
    primaryCatId = primary.json().category.id;
    const a = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Livres', kind: 'expense' },
    });
    splitA = a.json().category.id;
    const b = await app.inject({
      method: 'POST', url: '/api/categories', headers: { cookie },
      payload: { name: 'Electro', kind: 'expense' },
    });
    splitB = b.json().category.id;

    // Onboarding creates a default 'Divers' category; find its id so tests
    // can assert on category_source='default'.
    const { db } = await import('../src/db/client.js');
    const { categories } = await import('../src/db/schema.js');
    const [defaultRow] = await db
      .select().from(categories)
      .where(and(eq(categories.userId, uid), eq(categories.isDefault, true)));
    defaultCatId = defaultRow!.id;
    void defaultCatId;
    void isNotNull;
  });

  afterEach(async () => {
    const { db } = await import('../src/db/client.js');
    const { rules, transactions, transactionSplits } = await import('../src/db/schema.js');
    // Splits + txs first so the amount-lock trigger doesn't block a rule cleanup.
    await db.delete(transactionSplits);
    await db.delete(transactions);
    await db.delete(rules);
  });

  it('recategorize emits transaction_splits from a matched split-mode rule', async () => {
    await createRule({
      keyword: 'amazon',
      categoryId: primaryCatId,
      splits: [
        { categoryId: splitA, percent: 70 },
        { categoryId: splitB, percent: 30 },
      ],
    });
    const txId = await seedTransaction(-100, 'AMAZON EU S.A.R.L.');

    const res = await app.inject({
      method: 'POST', url: '/api/recategorize', headers: { cookie },
      payload: { preserveManual: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().splitsEmitted).toBe(1);

    const splits = await fetchSplits(txId);
    expect(splits).toHaveLength(2);
    const sumCents = splits.reduce((acc, s) => acc + Math.round(Number(s.amount) * 100), 0);
    expect(sumCents).toBe(-10000);
    expect(new Set(splits.map((s) => s.categoryId))).toEqual(new Set([splitA, splitB]));

    const parent = await fetchTx(txId);
    expect(parent.categoryId).toBe(primaryCatId);
    expect(parent.categorySource).toBe('auto');
    expect(parent.splitsSource).toBe('auto');
  });

  it('preserves splits_source=manual against a split-mode rule re-run', async () => {
    await createRule({
      keyword: 'amazon',
      categoryId: primaryCatId,
      splits: [
        { categoryId: splitA, percent: 70 },
        { categoryId: splitB, percent: 30 },
      ],
    });
    const txId = await seedTransaction(-100, 'AMAZON MARKETPLACE');
    // First run: auto-emit.
    await app.inject({
      method: 'POST', url: '/api/recategorize', headers: { cookie },
      payload: { preserveManual: false },
    });
    // Manual replace via the splits route — stamps splits_source='manual'.
    await app.inject({
      method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
      payload: {
        splits: [
          { categoryId: splitA, amount: '-40.00' },
          { categoryId: splitB, amount: '-60.00' },
        ],
      },
    });
    let parent = await fetchTx(txId);
    expect(parent.splitsSource).toBe('manual');

    // Second run — even with preserveManual=false, splits_source='manual'
    // must be preserved.
    const res = await app.inject({
      method: 'POST', url: '/api/recategorize', headers: { cookie },
      payload: { preserveManual: false },
    });
    expect(res.json().preserved).toBeGreaterThanOrEqual(1);

    parent = await fetchTx(txId);
    expect(parent.splitsSource).toBe('manual');
    const splits = await fetchSplits(txId);
    // 40/60, still the user's version.
    const amounts = splits.map((s) => Number(s.amount)).sort((a, b) => a - b);
    expect(amounts).toEqual([-60, -40]);
  });

  it('re-emits when splits_source=auto and the rule ratios change', async () => {
    const ruleId = await createRule({
      keyword: 'amazon',
      categoryId: primaryCatId,
      splits: [
        { categoryId: splitA, percent: 70 },
        { categoryId: splitB, percent: 30 },
      ],
    });
    const txId = await seedTransaction(-100, 'AMAZON RETAIL');
    await app.inject({
      method: 'POST', url: '/api/recategorize', headers: { cookie },
      payload: { preserveManual: false },
    });

    // Swap ratios via PUT — 40/60 now.
    await app.inject({
      method: 'PUT', url: `/api/rules/${ruleId}`, headers: { cookie },
      payload: {
        splits: [
          { categoryId: splitA, percent: 40 },
          { categoryId: splitB, percent: 60 },
        ],
      },
    });
    await app.inject({
      method: 'POST', url: '/api/recategorize', headers: { cookie },
      payload: { preserveManual: false },
    });

    const splits = await fetchSplits(txId);
    const byCat = new Map(splits.map((s) => [s.categoryId, Number(s.amount)]));
    expect(byCat.get(splitA)).toBe(-40);
    expect(byCat.get(splitB)).toBe(-60);
    const parent = await fetchTx(txId);
    expect(parent.splitsSource).toBe('auto');
  });

  it('clears auto-splits when a formerly split-mode rule reverts to single-category', async () => {
    const ruleId = await createRule({
      keyword: 'amazon',
      categoryId: primaryCatId,
      splits: [
        { categoryId: splitA, percent: 50 },
        { categoryId: splitB, percent: 50 },
      ],
    });
    const txId = await seedTransaction(-100, 'AMAZON MEDIA');
    await app.inject({
      method: 'POST', url: '/api/recategorize', headers: { cookie },
      payload: { preserveManual: false },
    });
    // Revert to single-category via splits:null.
    await app.inject({
      method: 'PUT', url: `/api/rules/${ruleId}`, headers: { cookie },
      payload: { splits: null },
    });
    await app.inject({
      method: 'POST', url: '/api/recategorize', headers: { cookie },
      payload: { preserveManual: false },
    });

    const splits = await fetchSplits(txId);
    expect(splits).toHaveLength(0);
    const parent = await fetchTx(txId);
    expect(parent.categoryId).toBe(primaryCatId);
    expect(parent.splitsSource).toBeNull();
  });

  it('does not touch a single-category rule match — regression guard', async () => {
    await createRule({
      keyword: 'boulangerie',
      categoryId: primaryCatId,
    });
    const txId = await seedTransaction(-5, 'BOULANGERIE DU COIN');
    const res = await app.inject({
      method: 'POST', url: '/api/recategorize', headers: { cookie },
      payload: { preserveManual: false },
    });
    expect(res.json().splitsEmitted).toBe(0);
    expect(res.json().recategorized).toBe(1);
    const splits = await fetchSplits(txId);
    expect(splits).toHaveLength(0);
    const parent = await fetchTx(txId);
    expect(parent.categoryId).toBe(primaryCatId);
    expect(parent.splitsSource).toBeNull();
  });
});
