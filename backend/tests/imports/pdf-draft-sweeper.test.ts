// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeEach } from 'vitest';

const RUN = !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('sweepExpiredDrafts', () => {
  let accountId: number;
  beforeEach(async () => {
    const { db } = await import('../../src/db/client.js');
    const { accounts, pdfImportDrafts } = await import('../../src/db/schema.js');
    await db.delete(pdfImportDrafts);
    const [acc] = await db.insert(accounts).values({
      name: 'Sweeper Test', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountId = acc!.id;
  });

  it('deletes drafts whose expires_at is in the past', async () => {
    const { db } = await import('../../src/db/client.js');
    const { pdfImportDrafts } = await import('../../src/db/schema.js');
    const { sweepExpiredDrafts } = await import('../../src/domain/imports/pdf/draft-sweeper.js');
    await db.insert(pdfImportDrafts).values([
      { accountId, pdfBytes: 'x', textItems: [], fingerprint: 'fp1',
        expiresAt: new Date(Date.now() - 1000) },
      { accountId, pdfBytes: 'y', textItems: [], fingerprint: 'fp2',
        expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const n = await sweepExpiredDrafts();
    expect(n).toBe(1);
    const remaining = await db.select().from(pdfImportDrafts);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.fingerprint).toBe('fp2');
  });
});
