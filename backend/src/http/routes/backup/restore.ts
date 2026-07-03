import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import {
  accounts,
  accountFilenamePatterns,
  balanceCheckpoints,
  categories,
  fileImports,
  rules,
  transactions,
  transferRules,
} from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { BackupBody, fileImportKey } from './schema.js';

// REPLACE semantics, scoped to the calling user only. Wipes only the caller's
// rows (via WHERE user_id = $uid) and reinserts every row from the dump with
// that user_id stamped. Other users' data is untouched.
export function registerRestoreRoute(app: FastifyInstance): void {
  app.post('/api/backup/import', {
    bodyLimit: 50 * 1024 * 1024,
  }, async (req, reply) => {
    const uid = userId(req);
    const parsed = BackupBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid backup format',
        issues: parsed.error.issues,
      });
    }
    const dump = parsed.data;

    const result = await db.transaction(async (tx) => {
      // Wipe only THIS user's rows, in reverse dependency order.
      await tx.delete(transactions).where(eq(transactions.userId, uid));
      await tx.delete(fileImports).where(eq(fileImports.userId, uid));
      await tx.delete(rules).where(eq(rules.userId, uid));
      await tx.delete(transferRules).where(eq(transferRules.userId, uid));
      await tx.delete(balanceCheckpoints).where(eq(balanceCheckpoints.userId, uid));
      await tx.delete(accountFilenamePatterns).where(eq(accountFilenamePatterns.userId, uid));
      await tx.delete(categories).where(eq(categories.userId, uid));
      await tx.delete(accounts).where(eq(accounts.userId, uid));

      const accountIdByName = new Map<string, number>();
      for (const a of dump.accounts) {
        const [inserted] = await tx
          .insert(accounts)
          .values({
            userId: uid,
            name: a.name,
            type: a.type,
            currency: a.currency,
            openingBalance: a.openingBalance,
            openingDate: a.openingDate,
            displayOrder: a.displayOrder ?? 0,
            lockYears: a.lockYears ?? null,
          })
          .returning({ id: accounts.id });
        if (inserted) accountIdByName.set(a.name, inserted.id);
      }

      const categoryIdByName = new Map<string, number>();
      let defaultId: number | null = null;
      for (const c of dump.categories) {
        const [inserted] = await tx
          .insert(categories)
          .values({
            userId: uid,
            name: c.name,
            // Old backups may carry kind='transfer'; the app dropped that
            // value (migration 0010) — coerce to 'neutral' on restore.
            kind: c.kind === 'transfer' ? 'neutral' : c.kind,
            color: c.color ?? null,
            parentId: null,
            isDefault: c.isDefault,
            isInternalTransfer: c.isInternalTransfer ?? false,
          })
          .returning({ id: categories.id });
        if (inserted) {
          categoryIdByName.set(c.name, inserted.id);
          if (c.isDefault) defaultId = inserted.id;
        }
      }
      for (const c of dump.categories) {
        if (c.parent) {
          const childId = categoryIdByName.get(c.name);
          const parentId = categoryIdByName.get(c.parent);
          if (childId && parentId) {
            await tx
              .update(categories)
              .set({ parentId })
              .where(and(eq(categories.id, childId), eq(categories.userId, uid)));
          }
        }
      }
      // Seed Divers if the dump didn't bring its own default.
      if (defaultId === null) {
        const [inserted] = await tx
          .insert(categories)
          .values({ userId: uid, name: 'Divers', kind: 'neutral', isDefault: true })
          .returning({ id: categories.id });
        if (inserted) {
          defaultId = inserted.id;
          categoryIdByName.set('Divers', inserted.id);
        }
      }

      for (const p of dump.accountFilenamePatterns) {
        const accId = p.account ? accountIdByName.get(p.account) : undefined;
        if (!accId) continue;
        await tx.insert(accountFilenamePatterns).values({
          userId: uid,
          pattern: p.pattern,
          accountId: accId,
          priority: p.priority,
        });
      }

      let rulesInserted = 0;
      for (const r of dump.rules) {
        const catId = r.category ? categoryIdByName.get(r.category) : undefined;
        if (!catId) continue;
        await tx.insert(rules).values({
          userId: uid,
          keyword: r.keyword,
          categoryId: catId,
          signConstraint: r.signConstraint,
          matchMode: r.matchMode,
          priority: r.priority,
          enabled: r.enabled,
        });
        rulesInserted++;
      }

      // transferRules is a legacy field — new exports don't emit it, but
      // restoring an old dump still re-inserts them so no data is lost.
      let transferRulesInserted = 0;
      for (const r of dump.transferRules ?? []) {
        const counterpartId = r.counterpartAccount
          ? accountIdByName.get(r.counterpartAccount)
          : undefined;
        await tx.insert(transferRules).values({
          userId: uid,
          keyword: r.keyword,
          direction: r.direction,
          counterpartAccountId: counterpartId ?? null,
          enabled: r.enabled,
        });
        transferRulesInserted++;
      }

      let checkpointsInserted = 0;
      for (const c of dump.balanceCheckpoints ?? []) {
        const accId = accountIdByName.get(c.account);
        if (!accId) continue;
        await tx.insert(balanceCheckpoints).values({
          userId: uid,
          accountId: accId,
          checkpointDate: c.checkpointDate,
          expectedAmount: c.expectedAmount,
          note: c.note ?? null,
        });
        checkpointsInserted++;
      }

      // file_imports — restore the Imports → Historique audit trail. Keep a
      // natural-key → new-id map so transactions can re-link via source_file_id.
      const fileImportIdByKey = new Map<string, number>();
      let fileImportsInserted = 0;
      for (const f of dump.fileImports ?? []) {
        const accId = accountIdByName.get(f.account);
        if (!accId) continue;
        const [inserted] = await tx
          .insert(fileImports)
          .values({
            userId: uid,
            accountId: accId,
            filename: f.filename,
            format: f.format,
            importedAt: new Date(f.importedAt),
            totalLines: f.totalLines,
            insertedCount: f.insertedCount,
            dedupSkipped: f.dedupSkipped,
            statedBalance: f.statedBalance ?? null,
            statedBalanceDate: f.statedBalanceDate ?? null,
          })
          .returning({ id: fileImports.id });
        if (inserted) {
          fileImportIdByKey.set(fileImportKey(f.filename, f.importedAt), inserted.id);
          fileImportsInserted++;
        }
      }

      let txCount = 0;
      for (const t of dump.transactions) {
        const accId = accountIdByName.get(t.account);
        if (!accId) continue;
        const catId = t.category ? categoryIdByName.get(t.category) ?? null : null;
        const srcId = t.sourceFileKey ? fileImportIdByKey.get(t.sourceFileKey) ?? null : null;
        await tx.insert(transactions).values({
          userId: uid,
          accountId: accId,
          date: t.date,
          amount: t.amount,
          rawLabel: t.rawLabel,
          normalizedLabel: t.normalizedLabel,
          memo: t.memo ?? null,
          notes: t.notes ?? null,
          fitid: t.fitid ?? null,
          dedupKey: t.dedupKey,
          categoryId: catId,
          categorySource: t.categorySource,
          transferGroupId: t.transferGroupId ?? null,
          sourceFileId: srcId,
          // Backup restores represent a known-good dataset the user has already
          // lived with — mark every imported row as "not a duplicate" so the
          // Possibles doublons panel starts empty after restore. Fresh imports
          // (PDF / OFX / CSV) made later will still surface new suspect groups.
          notDuplicate: true,
          lockYears: t.lockYears ?? null,
        });
        txCount++;
      }

      return {
        imported: {
          accounts: accountIdByName.size,
          categories: categoryIdByName.size,
          accountFilenamePatterns: dump.accountFilenamePatterns.length,
          rules: rulesInserted,
          transferRules: transferRulesInserted,
          balanceCheckpoints: checkpointsInserted,
          transactions: txCount,
          fileImports: fileImportsInserted,
        },
      };
    });

    return reply.code(200).send(result);
  });
}
