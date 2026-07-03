import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import {
  accounts,
  accountFilenamePatterns,
  balanceCheckpoints,
  categories,
  fileImports,
  rules,
  transactions,
} from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { VERSION, fileImportKey } from './schema.js';

// Emits a portable JSON dump using natural keys (account / category names).
// Multi-user safe: only the calling user's data is included.
//
// Transfer rules are intentionally NOT emitted — they've been superseded by
// the `is_internal_transfer` flag on categories, and every restore of an
// old dump still re-inserts them via the optional schema field, so historic
// backups keep round-tripping cleanly.
export function registerExportRoute(app: FastifyInstance): void {
  app.get('/api/backup/export', async (req, reply) => {
    const uid = userId(req);
    const [accs, cats, patterns, rls, txs, fimps, checkpoints] = await Promise.all([
      db.select().from(accounts).where(eq(accounts.userId, uid)),
      db.select().from(categories).where(eq(categories.userId, uid)),
      db.select().from(accountFilenamePatterns).where(eq(accountFilenamePatterns.userId, uid)),
      db.select().from(rules).where(eq(rules.userId, uid)),
      db.select().from(transactions).where(eq(transactions.userId, uid)),
      db.select().from(fileImports).where(eq(fileImports.userId, uid)),
      db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.userId, uid)),
    ]);

    const accountById = new Map(accs.map((a) => [a.id, a]));
    const categoryById = new Map(cats.map((c) => [c.id, c]));
    const fileImportById = new Map(fimps.map((f) => [f.id, f]));

    const dump = {
      version: VERSION,
      exportedAt: new Date().toISOString(),
      instance: 'athena-accounting',
      counts: {
        accounts: accs.length,
        categories: cats.length,
        rules: rls.length,
        transactions: txs.length,
        accountFilenamePatterns: patterns.length,
        fileImports: fimps.length,
        balanceCheckpoints: checkpoints.length,
      },
      accounts: accs.map((a) => ({
        name: a.name,
        type: a.type,
        currency: a.currency,
        openingBalance: a.openingBalance,
        openingDate: a.openingDate,
        displayOrder: a.displayOrder,
        lockYears: a.lockYears,
      })),
      categories: cats.map((c) => ({
        name: c.name,
        kind: c.kind,
        color: c.color,
        parent: c.parentId ? categoryById.get(c.parentId)?.name ?? null : null,
        isDefault: c.isDefault,
        isInternalTransfer: c.isInternalTransfer,
      })),
      accountFilenamePatterns: patterns.map((p) => ({
        pattern: p.pattern,
        account: accountById.get(p.accountId)?.name ?? null,
        priority: p.priority,
      })),
      rules: rls.map((r) => ({
        keyword: r.keyword,
        category: categoryById.get(r.categoryId)?.name ?? null,
        signConstraint: r.signConstraint,
        matchMode: r.matchMode,
        priority: r.priority,
        enabled: r.enabled,
      })),
      transactions: txs.map((t) => {
        const src = t.sourceFileId ? fileImportById.get(t.sourceFileId) : undefined;
        return {
          account: accountById.get(t.accountId)?.name ?? null,
          date: t.date,
          amount: t.amount,
          rawLabel: t.rawLabel,
          normalizedLabel: t.normalizedLabel,
          memo: t.memo,
          notes: t.notes,
          fitid: t.fitid,
          dedupKey: t.dedupKey,
          category: t.categoryId ? categoryById.get(t.categoryId)?.name ?? null : null,
          categorySource: t.categorySource,
          transferGroupId: t.transferGroupId,
          sourceFileKey: src ? fileImportKey(src.filename, src.importedAt.toISOString()) : null,
          notDuplicate: t.notDuplicate,
          lockYears: t.lockYears,
        };
      }),
      fileImports: fimps.map((f) => ({
        account: accountById.get(f.accountId)?.name ?? null,
        filename: f.filename,
        format: f.format,
        importedAt: f.importedAt.toISOString(),
        totalLines: f.totalLines,
        insertedCount: f.insertedCount,
        dedupSkipped: f.dedupSkipped,
        statedBalance: f.statedBalance,
        statedBalanceDate: f.statedBalanceDate,
      })),
      balanceCheckpoints: checkpoints.map((c) => ({
        account: accountById.get(c.accountId)?.name ?? null,
        checkpointDate: c.checkpointDate,
        expectedAmount: c.expectedAmount,
        note: c.note,
      })),
    };

    // Local-time stamp so multiple exports on the same day stay distinct in the
    // download folder. Shape: athena-backup-YYYY-MM-DD-HHMMSS.json
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="athena-backup-${stamp}.json"`);
    return dump;
  });
}
