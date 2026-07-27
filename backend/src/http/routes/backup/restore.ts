import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import {
  accounts,
  accountFilenamePatterns,
  balanceCheckpoints,
  categories,
  categoryBudgets,
  fileImports,
  rules,
  transactions,
  transactionSplits,
  transferRules,
} from '../../../db/schema.js';
import { userId } from '../../plugins/auth.js';
import { wipeUserData } from './wipe.js';
import { BackupBody, fileImportKey } from './schema.js';
import { decryptEnvelope, isEncryptedEnvelope } from './crypto.js';
import {
  normalizeCategoryKind,
  resolveCategoryRef,
  resolveNameToId,
} from './helpers.js';

// REPLACE semantics, scoped to the calling user only. Wipes only the caller's
// rows (via WHERE user_id = $uid) and reinserts every row from the dump with
// that user_id stamped. Other users' data is untouched.
export function registerRestoreRoute(app: FastifyInstance): void {
  app.post('/api/backup/import', {
    bodyLimit: 50 * 1024 * 1024,
  }, async (req, reply) => {
    const uid = userId(req);
    // Encrypted (enc1) files arrive as the envelope plus a sibling
    // `passphrase` field. Decrypt-and-reparse happens BEFORE the wipe
    // transaction below, so a wrong passphrase can never destroy data.
    let payload: unknown = req.body;
    if (isEncryptedEnvelope(payload)) {
      const pass = (req.body as Record<string, unknown>).passphrase;
      if (typeof pass !== 'string' || pass.length < 8) {
        return reply.code(400).send({ error: 'passphrase required for an encrypted backup' });
      }
      try {
        payload = JSON.parse(decryptEnvelope(payload, pass));
      } catch {
        // Wrong passphrase, tampered file, or non-JSON plaintext — GCM
        // can't distinguish and neither should the client-facing error.
        return reply.code(400).send({ error: 'wrong passphrase or corrupted backup file' });
      }
    }
    const parsed = BackupBody.safeParse(payload);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid backup format',
        issues: parsed.error.issues,
      });
    }
    const dump = parsed.data;

    const result = await db.transaction(async (tx) => {
      // TRUNCATE when solo, per-user DELETEs otherwise — see wipe.ts for the
      // PGlite busy-wait rationale.
      await wipeUserData(tx, uid);

      const accountIdByName = new Map<string, number>();
      for (const a of dump.accounts) {
        // Fold the legacy isInvestment flag (v2 backups) into the type column.
        // A v2 backup carrying isInvestment=true always meant "Placé" on the
        // Dashboard, regardless of the recorded type — mirror that here.
        const type = a.isInvestment ? 'investment' : a.type;
        const [inserted] = await tx
          .insert(accounts)
          .values({
            userId: uid,
            name: a.name,
            type,
            currency: a.currency,
            openingBalance: a.openingBalance,
            openingDate: a.openingDate,
            displayOrder: a.displayOrder ?? 0,
            lockYears: a.lockYears ?? null,
          })
          .returning({ id: accounts.id });
        if (inserted) accountIdByName.set(a.name, inserted.id);
      }

      // Category ids: keyed by path so same-name-under-different-parents doesn't collide.
      // Also keep a name→ids[] map for backward-compat resolution of v3 downstream refs.
      const categoryIdByPath = new Map<string, number>();
      const categoryIdsByName = new Map<string, number[]>();
      let defaultId: number | null = null;

      const rootRows = dump.categories.filter((c) => !c.parent);
      const childRows = dump.categories.filter((c) => !!c.parent);

      for (const c of rootRows) {
        const [inserted] = await tx
          .insert(categories)
          .values({
            userId: uid,
            name: c.name,
            kind: normalizeCategoryKind(c.kind),
            color: c.color ?? null,
            parentId: null,
            isDefault: c.isDefault,
            isInternalTransfer: c.isInternalTransfer ?? false,
          })
          .returning({ id: categories.id });
        if (inserted) {
          categoryIdByPath.set(`::${c.name}`, inserted.id);
          const arr = categoryIdsByName.get(c.name) ?? [];
          arr.push(inserted.id);
          categoryIdsByName.set(c.name, arr);
          if (c.isDefault) defaultId = inserted.id;
        }
      }

      for (const c of childRows) {
        const parentId = categoryIdByPath.get(`::${c.parent!}`);
        if (parentId == null) {
          // Parent didn't restore (self-orphan or missing) — skip this child;
          // its downstream refs will fall through to the name-only fallback.
          continue;
        }
        const [inserted] = await tx
          .insert(categories)
          .values({
            userId: uid,
            name: c.name,
            kind: normalizeCategoryKind(c.kind),
            color: c.color ?? null,
            parentId,
            isDefault: c.isDefault,
            isInternalTransfer: c.isInternalTransfer ?? false,
          })
          .returning({ id: categories.id });
        if (inserted) {
          categoryIdByPath.set(`${c.parent!}::${c.name}`, inserted.id);
          const arr = categoryIdsByName.get(c.name) ?? [];
          arr.push(inserted.id);
          categoryIdsByName.set(c.name, arr);
          if (c.isDefault) defaultId = inserted.id;
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
          categoryIdByPath.set('::Divers', inserted.id);
          categoryIdsByName.set('Divers', [inserted.id]);
        }
      }

      for (const p of dump.accountFilenamePatterns) {
        const accId = resolveNameToId(p.account, accountIdByName);
        if (accId === null) continue;
        await tx.insert(accountFilenamePatterns).values({
          userId: uid,
          pattern: p.pattern,
          accountId: accId,
          priority: p.priority,
        });
      }

      let rulesInserted = 0;
      for (const r of dump.rules) {
        const catId = resolveCategoryRef(r.category, r.categoryParent, categoryIdByPath, categoryIdsByName);
        if (catId === null) continue;
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
        const counterpartId = resolveNameToId(r.counterpartAccount, accountIdByName);
        await tx.insert(transferRules).values({
          userId: uid,
          keyword: r.keyword,
          direction: r.direction,
          counterpartAccountId: counterpartId,
          enabled: r.enabled,
        });
        transferRulesInserted++;
      }

      let checkpointsInserted = 0;
      for (const c of dump.balanceCheckpoints ?? []) {
        const accId = resolveNameToId(c.account, accountIdByName);
        if (accId === null) continue;
        await tx.insert(balanceCheckpoints).values({
          userId: uid,
          accountId: accId,
          checkpointDate: c.checkpointDate,
          expectedAmount: c.expectedAmount,
          note: c.note ?? null,
        });
        checkpointsInserted++;
      }

      let budgetsInserted = 0;
      for (const b of dump.budgets ?? []) {
        const catId = resolveCategoryRef(b.category, b.categoryParent, categoryIdByPath, categoryIdsByName);
        if (catId === null) continue;
        const budgetAccountId = resolveNameToId(b.account ?? null, accountIdByName);
        if (b.account != null && budgetAccountId == null) {
          // The dump's account name didn't resolve (e.g. renamed/removed
          // account). Skip rather than silently downgrading to a global
          // budget: if a global variant for the same (category, period)
          // already exists in the dump, that silent downgrade would hit the
          // unique index and abort the whole restore transaction.
          req.log.warn(
            { category: b.category, account: b.account },
            'restore: budget account name did not resolve; skipping scoped budget',
          );
          continue;
        }
        await tx.insert(categoryBudgets).values({
          userId: uid,
          categoryId: catId,
          monthlyLimit: b.monthlyLimit,
          currency: b.currency,
          period: b.period ?? 'monthly',
          accountId: budgetAccountId,
        });
        budgetsInserted++;
      }

      // file_imports — restore the Imports → Historique audit trail. Keep a
      // natural-key → new-id map so transactions can re-link via source_file_id.
      const fileImportIdByKey = new Map<string, number>();
      let fileImportsInserted = 0;
      for (const f of dump.fileImports ?? []) {
        const accId = resolveNameToId(f.account, accountIdByName);
        if (accId === null) continue;
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
        const accId = resolveNameToId(t.account, accountIdByName);
        if (accId === null) continue;
        const catId = resolveCategoryRef(t.category, t.categoryParent, categoryIdByPath, categoryIdsByName);
        const srcId = resolveNameToId(t.sourceFileKey, fileImportIdByKey);
        const [insertedTx] = await tx.insert(transactions).values({
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
        }).returning({ id: transactions.id });
        txCount++;

        if (insertedTx && t.splits && t.splits.length > 0) {
          const rows = t.splits.map((s) => ({
            transactionId: insertedTx.id,
            categoryId: resolveCategoryRef(s.category, s.categoryParent, categoryIdByPath, categoryIdsByName),
            amount: s.amount,
            memo: s.memo ?? null,
          }));
          await tx.insert(transactionSplits).values(rows);
        }
      }

      return {
        imported: {
          accounts: accountIdByName.size,
          categories: categoryIdByPath.size,
          accountFilenamePatterns: dump.accountFilenamePatterns.length,
          rules: rulesInserted,
          transferRules: transferRulesInserted,
          balanceCheckpoints: checkpointsInserted,
          budgets: budgetsInserted,
          transactions: txCount,
          fileImports: fileImportsInserted,
        },
      };
    });

    return reply.code(200).send(result);
  });
}
