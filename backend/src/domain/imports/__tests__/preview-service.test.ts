// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { PreviewResult } from '../preview-service.js';

const RUN = !!process.env.RUN_DB_TESTS;

let userId: number;
let accountId: number;

describe.skipIf(!RUN)('previewImport', () => {
  beforeAll(async () => {
    const { db } = await import('../../../db/client.js');
    const { users, accounts } = await import('../../../db/schema.js');
    const [u] = await db.insert(users).values({
      username: 'preview-service-user',
      passwordHash: 'x',
    }).returning();
    userId = u!.id;
    const [a] = await db.insert(accounts).values({
      userId, name: 'Preview Service Test', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountId = a!.id;
  });

  afterEach(async () => {
    const { db } = await import('../../../db/client.js');
    const { transactions } = await import('../../../db/schema.js');
    await db.delete(transactions);
  });

  it('splits parsed rows into newRows and duplicateRows against an empty ledger', async () => {
    const { previewImport } = await import('../preview-service.js');
    const csv = 'Date;Libellé;Montant\n15/06/2026;Café;-3,50\n16/06/2026;Salaire;2000,00\n';
    const result: PreviewResult = await previewImport({
      filename: 'test.csv',
      accountId,
      userId,
      format: 'csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });
    expect(result.filename).toBe('test.csv');
    expect(result.format).toBe('csv');
    expect(result.accountId).toBe(accountId);
    expect(result.totalRows).toBe(2);
    expect(result.newRows).toHaveLength(2);
    expect(result.duplicateRows).toHaveLength(0);
  });

  it('flags rows that already exist in the ledger as duplicates', async () => {
    const { runImport } = await import('../import-service.js');
    const { previewImport } = await import('../preview-service.js');
    const csvSeed = 'Date;Libellé;Montant\n15/06/2026;Café;-3,50\n';
    await runImport({
      filename: 'seed.csv',
      accountId, userId, format: 'csv',
      buffer: Buffer.from(csvSeed, 'utf-8'),
    });

    const csvPreview = 'Date;Libellé;Montant\n15/06/2026;Café;-3,50\n17/06/2026;Nouveau;-5,00\n';
    const result = await previewImport({
      filename: 'again.csv', accountId, userId, format: 'csv',
      buffer: Buffer.from(csvPreview, 'utf-8'),
    });
    expect(result.totalRows).toBe(2);
    expect(result.newRows).toHaveLength(1);
    expect(result.newRows[0]!.rawLabel).toBe('Nouveau');
    expect(result.duplicateRows).toHaveLength(1);
    expect(result.duplicateRows[0]!.rawLabel).toBe('Café');
  });

  it('never inserts a fileImports row or a transactions row', async () => {
    const { db } = await import('../../../db/client.js');
    const { fileImports, transactions } = await import('../../../db/schema.js');
    const { previewImport } = await import('../preview-service.js');
    const csv = 'Date;Libellé;Montant\n15/06/2026;X;-1,00\n';
    await previewImport({
      filename: 'x.csv', accountId, userId, format: 'csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });
    const fi = await db.select().from(fileImports);
    const tx = await db.select().from(transactions);
    expect(fi).toHaveLength(0);
    expect(tx).toHaveLength(0);
  });
});
