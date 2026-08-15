import { db } from '../../../db/client.js';
import {
  fileImports,
  savingsGoalEvents,
  savingsGoals,
  transactions,
  transactionSplits,
} from '../../../db/schema.js';
import { fileImportKey, type BackupDump } from './schema.js';
import { resolveCategoryRef, resolveNameToId } from './helpers.js';
import type { CategoryMaps } from './restore-steps.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Restore the Imports → Historique audit trail. Returns a natural-key → new-id
// map so transactions can re-link via source_file_id.
export async function restoreFileImports(
  tx: Tx,
  uid: number,
  dumpFileImports: NonNullable<BackupDump['fileImports']>,
  accountIdByName: Map<string, number>,
): Promise<{ map: Map<string, number>; count: number }> {
  const map = new Map<string, number>();
  let count = 0;
  for (const f of dumpFileImports) {
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
      map.set(fileImportKey(f.filename, f.importedAt), inserted.id);
      count++;
    }
  }
  return { map, count };
}

export async function restoreTransactions(
  tx: Tx,
  uid: number,
  dumpTransactions: BackupDump['transactions'],
  accountIdByName: Map<string, number>,
  cats: CategoryMaps,
  fileImportIdByKey: Map<string, number>,
): Promise<number> {
  let count = 0;
  for (const t of dumpTransactions) {
    const accId = resolveNameToId(t.account, accountIdByName);
    if (accId === null) continue;
    const catId = resolveCategoryRef(t.category, t.categoryParent, cats.categoryIdByPath, cats.categoryIdsByName);
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
    count++;

    if (insertedTx && t.splits && t.splits.length > 0) {
      const rows = t.splits.map((s) => ({
        transactionId: insertedTx.id,
        categoryId: resolveCategoryRef(s.category, s.categoryParent, cats.categoryIdByPath, cats.categoryIdsByName),
        amount: s.amount,
        memo: s.memo ?? null,
      }));
      await tx.insert(transactionSplits).values(rows);
    }
  }
  return count;
}

export type GoalCounters = {
  goalsInserted: number;
  goalsSkipped: number;
  eventsInserted: number;
  eventsSkipped: number;
};

// Savings goals: natural key is (accountName, goalName). Events link back to
// their goal by the same pair. Goals whose account did not resolve are silently
// skipped; events whose goal did not resolve are skipped and counted (matches
// the rules/budgets convention).
export async function restoreSavingsGoalsAndEvents(
  tx: Tx,
  uid: number,
  dumpGoals: NonNullable<BackupDump['savingsGoals']>,
  dumpEvents: NonNullable<BackupDump['savingsGoalEvents']>,
  accountIdByName: Map<string, number>,
): Promise<GoalCounters> {
  const goalIdByKey = new Map<string, number>();
  let goalsInserted = 0;
  let goalsSkipped = 0;
  for (const g of dumpGoals) {
    const accId = resolveNameToId(g.account, accountIdByName);
    if (accId === null) { goalsSkipped++; continue; }
    const [inserted] = await tx.insert(savingsGoals).values({
      userId: uid,
      accountId: accId,
      name: g.name,
      targetAmount: g.targetAmount,
      targetDate: g.targetDate ?? null,
      color: g.color ?? null,
      closedAt: g.closedAt ? new Date(g.closedAt) : null,
    }).returning({ id: savingsGoals.id });
    if (inserted) {
      goalIdByKey.set(`${g.account}::${g.name}`, inserted.id);
      goalsInserted++;
    }
  }

  let eventsInserted = 0;
  let eventsSkipped = 0;
  for (const e of dumpEvents) {
    const goalId = goalIdByKey.get(`${e.account}::${e.goal}`);
    if (goalId === undefined) { eventsSkipped++; continue; }
    await tx.insert(savingsGoalEvents).values({
      userId: uid,
      goalId,
      amount: e.amount,
      eventDate: e.eventDate,
      note: e.note ?? null,
    });
    eventsInserted++;
  }

  return { goalsInserted, goalsSkipped, eventsInserted, eventsSkipped };
}
