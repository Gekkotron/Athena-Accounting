// requires Postgres + onboarding setup — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let accountId: number;
let categoryId: number;

async function seedSomeData() {
  const acc = await app.inject({
    method: 'POST', url: '/api/accounts',
    headers: { cookie },
    payload: { name: 'BackupA', type: 'checking', currency: 'EUR', openingBalance: '100', openingDate: '2025-01-01' },
  });
  accountId = acc.json().account.id;

  const cat = await app.inject({
    method: 'POST', url: '/api/categories',
    headers: { cookie }, payload: { name: 'BackupCat', kind: 'expense' },
  });
  categoryId = cat.json().category.id;

  await app.inject({
    method: 'POST', url: '/api/rules',
    headers: { cookie },
    payload: { categoryId, keyword: 'backupmerchant', priority: 5 },
  });

  await app.inject({
    method: 'POST', url: '/api/transfer-rules',
    headers: { cookie },
    payload: { keyword: 'VIR BACKUP', direction: 'outgoing' },
  });

  await app.inject({
    method: 'POST', url: '/api/account-filename-patterns',
    headers: { cookie },
    payload: { pattern: 'backup_*.ofx', accountId, priority: 10 },
  });

  await app.inject({
    method: 'POST', url: '/api/transactions',
    headers: { cookie },
    payload: { accountId, date: '2026-06-15', amount: '-42.30', rawLabel: 'CB BACKUPMERCHANT' },
  });
}

async function wipeUserData() {
  const { db } = await import('../src/db/client.js');
  const {
    accounts, categories, rules, transferRules, accountFilenamePatterns,
    balanceCheckpoints, transactions, fileImports,
  } = await import('../src/db/schema.js');
  const { and, eq } = await import('drizzle-orm');
  await db.delete(transactions);
  await db.delete(fileImports);
  await db.delete(accountFilenamePatterns);
  await db.delete(rules);
  await db.delete(transferRules);
  await db.delete(balanceCheckpoints);
  await db.delete(categories).where(and(eq(categories.isDefault, false)));
  await db.delete(accounts);
}

describe.skipIf(!RUN)('/api/backup', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'backup-user', password: 'backup-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'backup-user', password: 'backup-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  afterEach(async () => { await wipeUserData(); });

  describe('GET /api/backup/export', () => {
    it('returns a JSON attachment with version + counts + rows', async () => {
      await seedSomeData();
      const res = await app.inject({
        method: 'GET', url: '/api/backup/export', headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('athena-backup-');
      const dump = res.json();
      expect(dump.version).toBe(2);
      expect(dump.instance).toBe('athena-accounting');
      expect(dump.counts.accounts).toBeGreaterThanOrEqual(1);
      expect(dump.counts.categories).toBeGreaterThanOrEqual(1);
      expect(dump.counts.rules).toBe(1);
      // Transfer rules are no longer emitted (see backup/export.ts). The
      // count key is absent entirely; the transferRules payload field too.
      expect(dump.counts.transferRules).toBeUndefined();
      expect(dump.transferRules).toBeUndefined();
      // Per-account balance checkpoints are part of the export shape now.
      expect(dump.counts.balanceCheckpoints).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(dump.balanceCheckpoints)).toBe(true);
      expect(dump.counts.transactions).toBe(1);
      expect(dump.counts.accountFilenamePatterns).toBe(1);
      expect(dump.accounts[0].name).toBe('BackupA');
      expect(dump.transactions[0].account).toBe('BackupA');
    });

    it('emits an empty dump when the user has no data', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/backup/export', headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const dump = res.json();
      expect(dump.accounts).toEqual([]);
      expect(dump.transactions).toEqual([]);
      expect(dump.counts.accounts).toBe(0);
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/backup/export' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/backup/import', () => {
    it('roundtrips: export → wipe → import restores the same data shape', async () => {
      await seedSomeData();
      const exp = await app.inject({
        method: 'GET', url: '/api/backup/export', headers: { cookie },
      });
      const dump = exp.json();
      await wipeUserData();

      const imp = await app.inject({
        method: 'POST', url: '/api/backup/import',
        headers: { cookie },
        payload: dump,
      });
      expect(imp.statusCode).toBe(200);
      // Restore response shape includes the counts of what was inserted.
      const body = imp.json();
      expect(body.imported.accounts).toBeGreaterThanOrEqual(1);
      expect(body.imported.transactions).toBeGreaterThanOrEqual(1);

      const accs = await app.inject({
        method: 'GET', url: '/api/accounts', headers: { cookie },
      });
      expect(accs.json().accounts.find((a: { name: string }) => a.name === 'BackupA')).toBeTruthy();
    });

    it('rejects an unknown version with 400', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/backup/import',
        headers: { cookie },
        payload: { version: 3, accounts: [], categories: [], accountFilenamePatterns: [], rules: [], transferRules: [], transactions: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/backup format/i);
    });

    it('rejects malformed payloads with 400', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/backup/import',
        headers: { cookie },
        payload: { version: 1 }, // missing everything else
      });
      expect(res.statusCode).toBe(400);
    });

    it('roundtrips per-account balance checkpoints', async () => {
      await seedSomeData();
      // Fetch the seeded account id, then create a checkpoint on it.
      const accs = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
      const backupA = accs.json().accounts.find((a: { name: string }) => a.name === 'BackupA')!;
      const cpRes = await app.inject({
        method: 'POST', url: `/api/accounts/${backupA.id}/balance-checkpoints`,
        headers: { cookie },
        payload: { checkpointDate: '2026-05-31', expectedAmount: '1234.56', note: 'mai' },
      });
      expect(cpRes.statusCode).toBe(201);

      const exp = await app.inject({ method: 'GET', url: '/api/backup/export', headers: { cookie } });
      const dump = exp.json();
      expect(dump.counts.balanceCheckpoints).toBe(1);
      expect(dump.balanceCheckpoints).toEqual([{
        account: 'BackupA', checkpointDate: '2026-05-31', expectedAmount: '1234.56', note: 'mai',
      }]);

      await wipeUserData();

      const imp = await app.inject({
        method: 'POST', url: '/api/backup/import',
        headers: { cookie }, payload: dump,
      });
      expect(imp.statusCode).toBe(200);
      expect(imp.json().imported.balanceCheckpoints).toBe(1);

      const roundtripped = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } });
      const restoredA = roundtripped.json().accounts.find((a: { name: string }) => a.name === 'BackupA')!;
      const cpsAfter = await app.inject({
        method: 'GET', url: `/api/accounts/${restoredA.id}/balance-checkpoints`,
        headers: { cookie },
      });
      expect(cpsAfter.json().checkpoints).toHaveLength(1);
      expect(cpsAfter.json().checkpoints[0].checkpointDate).toBe('2026-05-31');
      expect(cpsAfter.json().checkpoints[0].expectedAmount).toBe('1234.56');
      expect(cpsAfter.json().checkpoints[0].note).toBe('mai');
    });

    it('round-trips category budgets by category name', async () => {
      const cat = await app.inject({
        method: 'POST', url: '/api/categories',
        headers: { cookie }, payload: { name: 'Loisirs', kind: 'expense' },
      });
      const catId = cat.json().category.id;
      await app.inject({
        method: 'POST', url: '/api/budgets',
        headers: { cookie }, payload: { categoryId: catId, monthlyLimit: '150.00' },
      });

      const dump = (await app.inject({ method: 'GET', url: '/api/backup/export', headers: { cookie } })).json();
      expect(dump.budgets.find((b: { category: string }) => b.category === 'Loisirs').monthlyLimit).toBe('150.00');

      const restore = await app.inject({
        method: 'POST', url: '/api/backup/import', headers: { cookie }, payload: dump,
      });
      expect(restore.statusCode).toBe(200);

      const budgets = (await app.inject({ method: 'GET', url: '/api/budgets', headers: { cookie } })).json().budgets;
      expect(budgets).toHaveLength(1);
      expect(budgets[0].monthlyLimit).toBe('150.00');
    });

    it('round-trips a dump with same-name children under two different parents', async () => {
      // First: export the current empty user's dump so we have a valid v3+
      // envelope to base the test payload on.
      const dump = {
        version: 4,
        accounts: [{ name: 'Cur', type: 'checking', currency: 'EUR', openingBalance: '0.00', openingDate: '2026-01-01' }],
        categories: [
          { name: 'Loisirs', kind: 'expense', parent: null, isDefault: false, isInternalTransfer: false },
          { name: 'Voyages', kind: 'expense', parent: null, isDefault: false, isInternalTransfer: false },
          { name: 'Restaurant', kind: 'expense', parent: 'Loisirs', isDefault: false, isInternalTransfer: false },
          { name: 'Restaurant', kind: 'expense', parent: 'Voyages', isDefault: false, isInternalTransfer: false },
        ],
        accountFilenamePatterns: [],
        rules: [],
        transactions: [
          { account: 'Cur', date: '2026-06-01', amount: '-20.00', rawLabel: 'r1', normalizedLabel: 'r1',
            dedupKey: 'k1', category: 'Restaurant', categoryParent: 'Loisirs', categorySource: 'manual' },
          { account: 'Cur', date: '2026-06-02', amount: '-30.00', rawLabel: 'r2', normalizedLabel: 'r2',
            dedupKey: 'k2', category: 'Restaurant', categoryParent: 'Voyages', categorySource: 'manual' },
        ],
      };
      const res = await app.inject({
        method: 'POST', url: '/api/backup/import', headers: { cookie }, payload: dump,
      });
      expect(res.statusCode).toBe(200);

      // Both categories persisted, correctly parented.
      const cats = await app.inject({ method: 'GET', url: '/api/categories', headers: { cookie } });
      const catList = cats.json().categories as Array<{ id: number; name: string; parentId: number | null }>;
      const loisirsId = catList.find((c) => c.name === 'Loisirs')!.id;
      const voyagesId = catList.find((c) => c.name === 'Voyages')!.id;
      const restaurantIds = catList.filter((c) => c.name === 'Restaurant');
      expect(restaurantIds).toHaveLength(2);
      expect(restaurantIds.some((c) => c.parentId === loisirsId)).toBe(true);
      expect(restaurantIds.some((c) => c.parentId === voyagesId)).toBe(true);

      // Each transaction landed on the correct child (not collapsed).
      const txs = await app.inject({ method: 'GET', url: '/api/transactions', headers: { cookie } });
      const txList = txs.json().transactions as Array<{ amount: string; categoryId: number | null }>;
      const restaurantLoisirs = restaurantIds.find((c) => c.parentId === loisirsId)!.id;
      const restaurantVoyages = restaurantIds.find((c) => c.parentId === voyagesId)!.id;
      expect(txList.find((t) => t.amount === '-20.00')!.categoryId).toBe(restaurantLoisirs);
      expect(txList.find((t) => t.amount === '-30.00')!.categoryId).toBe(restaurantVoyages);
    });

    it('still restores a v3 dump (backward compatibility) where refs use name only', async () => {
      const dump = {
        version: 3,
        accounts: [{ name: 'Cur', type: 'checking', currency: 'EUR', openingBalance: '0.00', openingDate: '2026-01-01' }],
        categories: [
          { name: 'Loisirs', kind: 'expense', parent: null, isDefault: false, isInternalTransfer: false },
          { name: 'Restaurant', kind: 'expense', parent: 'Loisirs', isDefault: false, isInternalTransfer: false },
        ],
        accountFilenamePatterns: [],
        rules: [],
        transactions: [
          { account: 'Cur', date: '2026-06-01', amount: '-20.00', rawLabel: 'r1', normalizedLabel: 'r1',
            dedupKey: 'k1', category: 'Restaurant', categorySource: 'manual' },
        ],
      };
      const res = await app.inject({
        method: 'POST', url: '/api/backup/import', headers: { cookie }, payload: dump,
      });
      expect(res.statusCode).toBe(200);
      const txs = await app.inject({ method: 'GET', url: '/api/transactions', headers: { cookie } });
      const t = (txs.json().transactions as Array<{ amount: string; categoryId: number | null }>)
        .find((t) => t.amount === '-20.00')!;
      expect(t.categoryId).not.toBeNull(); // resolved to the sole "Restaurant"
    });

    it('coerces legacy kind=transfer categories to neutral', async () => {
      // Craft a minimal legacy-shaped dump: single category with kind:'transfer'.
      const payload = {
        version: 1,
        accounts: [{
          name: 'LegacyA', type: 'checking', currency: 'EUR',
          openingBalance: '0', openingDate: '2025-01-01',
        }],
        categories: [
          { name: 'Divers', kind: 'neutral', isDefault: true },
          { name: 'LegacyXfer', kind: 'transfer', isDefault: false },
        ],
        accountFilenamePatterns: [],
        rules: [],
        transferRules: [],
        transactions: [],
      };
      const res = await app.inject({
        method: 'POST', url: '/api/backup/import',
        headers: { cookie }, payload,
      });
      expect(res.statusCode).toBe(200);
      const cats = await app.inject({
        method: 'GET', url: '/api/categories', headers: { cookie },
      });
      const legacy = cats.json().categories.find((c: { name: string }) => c.name === 'LegacyXfer');
      expect(legacy).toBeTruthy();
      expect(legacy.kind).toBe('neutral'); // coerced on restore
    });

    it('rejects unauthenticated with 401', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/backup/import',
        payload: { version: 1 },
      });
      expect(res.statusCode).toBe(401);
    });

    it('exports splits as v2 and re-imports them intact', async () => {
      await seedSomeData();
      const cat2 = await app.inject({
        method: 'POST', url: '/api/categories',
        headers: { cookie }, payload: { name: 'BackupSplitCat', kind: 'expense' },
      });
      const categoryId2 = cat2.json().category.id;

      const tx = await app.inject({
        method: 'POST', url: '/api/transactions',
        headers: { cookie },
        payload: { accountId, date: '2026-07-04', amount: '-100.00', rawLabel: 'Amazon FR' },
      });
      const txId = tx.json().transaction.id;

      const put = await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId, amount: '-60.00', memo: 'Kindle' },
          { categoryId: categoryId2, amount: '-40.00' },
        ] },
      });
      expect(put.statusCode).toBe(200);

      const exported = await app.inject({
        method: 'GET', url: '/api/backup/export', headers: { cookie },
      });
      const dump = exported.json();
      expect(dump.version).toBe(2);
      const dumpedTx = (dump.transactions as Array<{ rawLabel: string; splits?: unknown[] }>)
        .find((t) => t.rawLabel === 'Amazon FR')!;
      expect(dumpedTx.splits).toHaveLength(2);

      await wipeUserData();

      const restored = await app.inject({
        method: 'POST', url: '/api/backup/import', headers: { cookie },
        payload: dump,
      });
      expect(restored.statusCode).toBe(200);

      const list = await app.inject({
        method: 'GET', url: '/api/transactions?fromDate=2026-07-04&toDate=2026-07-04',
        headers: { cookie },
      });
      const roundTripped = (list.json().transactions as Array<{
        rawLabel: string; splits: Array<{ amount: string }>;
      }>).find((t) => t.rawLabel === 'Amazon FR')!;
      expect(roundTripped.splits).toHaveLength(2);
      expect(roundTripped.splits.map((s) => s.amount).sort())
        .toEqual(['-40.00', '-60.00']);
    });

    it('re-importing overwrites existing splits (exercises the split-wipe path)', async () => {
      await seedSomeData();
      // Create a base split state.
      const txRes = await app.inject({
        method: 'POST', url: '/api/transactions', headers: { cookie },
        payload: {
          accountId, date: '2026-07-04', amount: '-100.00',
          rawLabel: 'Amazon overwrite test',
        },
      });
      const txId = txRes.json().transaction.id;
      const otherCat = await app.inject({
        method: 'POST', url: '/api/categories', headers: { cookie },
        payload: { name: 'OverwriteCat', kind: 'expense' },
      });
      const otherCatId = otherCat.json().category.id;
      await app.inject({
        method: 'PUT', url: `/api/transactions/${txId}/splits`, headers: { cookie },
        payload: { splits: [
          { categoryId, amount: '-60.00', memo: 'original' },
          { categoryId: otherCatId, amount: '-40.00' },
        ] },
      });

      // Export the current state.
      const firstExport = await app.inject({
        method: 'GET', url: '/api/backup/export', headers: { cookie },
      });
      const dump = firstExport.json();

      // Mutate the dump so the tx now has different splits.
      const dumpTx = (dump.transactions as Array<{ rawLabel: string; splits?: unknown[] }>)
        .find((t) => t.rawLabel === 'Amazon overwrite test')!;
      (dumpTx as { splits: unknown[] }).splits = [
        { category: 'OverwriteCat', amount: '-100.00' },
      ];

      // Restore WITHOUT wiping first — restore.ts should wipe old splits itself.
      const restored = await app.inject({
        method: 'POST', url: '/api/backup/import', headers: { cookie },
        payload: dump,
      });
      expect(restored.statusCode).toBe(200);

      // Fetch the transaction and confirm only the new split shape survived.
      const list = await app.inject({
        method: 'GET', url: `/api/transactions?fromDate=2026-07-04&toDate=2026-07-04`,
        headers: { cookie },
      });
      const roundTripped = (list.json().transactions as Array<{
        rawLabel: string; splits: Array<{ amount: string }>;
      }>).find((t) => t.rawLabel === 'Amazon overwrite test')!;
      expect(roundTripped.splits).toHaveLength(1);
      expect(roundTripped.splits[0].amount).toBe('-100.00');
    });

    it('imports a v1 dump without splits cleanly', async () => {
      const v1: Record<string, unknown> = {
        version: 1,
        accounts: [{
          name: 'From-v1', type: 'current', currency: 'EUR',
          openingBalance: '0', openingDate: '2025-01-01',
        }],
        categories: [{ name: 'Divers', kind: 'neutral', isDefault: true }],
        accountFilenamePatterns: [],
        rules: [],
        transactions: [{
          account: 'From-v1', date: '2026-01-01', amount: '-10.00',
          rawLabel: 'x', normalizedLabel: 'x', dedupKey: 'v1-dk',
          categorySource: 'auto',
        }],
      };
      const res = await app.inject({
        method: 'POST', url: '/api/backup/import', headers: { cookie }, payload: v1,
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
