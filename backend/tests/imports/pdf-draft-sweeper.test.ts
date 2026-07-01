// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeEach } from 'vitest';

const RUN = !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('sweepExpiredDrafts', () => {
  let accountId: number;
  let userId: number;
  beforeEach(async () => {
    const { db } = await import('../../src/db/client.js');
    const { accounts, pdfImportDrafts, users } = await import('../../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    await db.delete(pdfImportDrafts);
    const [user] = await db
      .insert(users)
      .values({ username: 'draft-sweeper-test', passwordHash: 'not-a-real-hash' })
      .onConflictDoNothing()
      .returning();
    if (user) {
      userId = user.id;
    } else {
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.username, 'draft-sweeper-test'));
      userId = existing!.id;
    }
    const [acc] = await db.insert(accounts).values({
      userId,
      name: 'Sweeper Test', type: 'checking', openingDate: '2025-01-01',
    }).returning();
    accountId = acc!.id;
  });

  it('deletes drafts whose expires_at is in the past', async () => {
    const { db } = await import('../../src/db/client.js');
    const { pdfImportDrafts } = await import('../../src/db/schema.js');
    const { sweepExpiredDrafts } = await import('../../src/domain/imports/pdf/draft-sweeper.js');
    await db.insert(pdfImportDrafts).values([
      { userId, accountId, pdfBytes: 'x', textItems: [], fingerprint: 'fp1',
        expiresAt: new Date(Date.now() - 1000) },
      { userId, accountId, pdfBytes: 'y', textItems: [], fingerprint: 'fp2',
        expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const n = await sweepExpiredDrafts();
    expect(n).toBe(1);
    const remaining = await db.select().from(pdfImportDrafts);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.fingerprint).toBe('fp2');
  });
});
