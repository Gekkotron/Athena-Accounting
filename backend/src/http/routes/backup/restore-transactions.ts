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
  const resolved: Array<{
    input: NonNullable<BackupDump['fileImports']>[number];
    values: typeof fileImports.$inferInsert;
  }> = [];
  for (const f of dumpFileImports) {
    const accId = resolveNameToId(f.account, accountIdByName);
    if (accId === null) continue;
    resolved.push({
      input: f,
      values: {
        userId: uid,
        accountId: accId,
        filename: f.filename,
        format: f.format,
        importedAt: new Date(f.importedAt),
        totalLines: f.totalLines,
        insertedCount: f.insertedCount,
        dedupSkipped: f.dedupSkipped,
        userSkipped: f.userSkipped,
        statedBalance: f.statedBalance ?? null,
        statedBalanceDate: f.statedBalanceDate ?? null,
      },
    });
  }
  if (resolved.length === 0) return { map, count: 0 };
  // Chunked bulk INSERT — RETURNING preserves VALUES order, so we can zip
  // returned ids back onto the input list to rebuild the natural-key map.
  for (let i = 0; i < resolved.length; i += RESTORE_TX_CHUNK) {
    const slice = resolved.slice(i, i + RESTORE_TX_CHUNK);
    const returned = await tx
      .insert(fileImports)
      .values(slice.map((r) => r.values))
      .returning({ id: fileImports.id });
    for (let j = 0; j < returned.length; j++) {
      map.set(fileImportKey(slice[j]!.input.filename, slice[j]!.input.importedAt), returned[j]!.id);
    }
  }
  return { map, count: resolved.length };
}

// Chunk size for bulk INSERT — matches the pattern already used by
// runImport. Kept at 500 so a single VALUES clause stays well under any
// Postgres parameter-count limit even for wide rows.
const RESTORE_TX_CHUNK = 500;

export async function restoreTransactions(
  tx: Tx,
  uid: number,
  dumpTransactions: BackupDump['transactions'],
  accountIdByName: Map<string, number>,
  cats: CategoryMaps,
  fileImportIdByKey: Map<string, number>,
): Promise<number> {
  // Pre-resolve every row's foreign keys once and drop any whose account
  // did not resolve (matches the pre-refactor per-row skip). This gives us
  // a flat array we can chunk-INSERT in constant round-trips.
  const rows: Array<{
    input: BackupDump['transactions'][number];
    values: typeof transactions.$inferInsert;
  }> = [];
  for (const t of dumpTransactions) {
    const accId = resolveNameToId(t.account, accountIdByName);
    if (accId === null) continue;
    const catId = resolveCategoryRef(t.category, t.categoryParent, cats.categoryIdByPath, cats.categoryIdsByName);
    const srcId = resolveNameToId(t.sourceFileKey, fileImportIdByKey);
    rows.push({
      input: t,
      values: {
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
      },
    });
  }
  if (rows.length === 0) return 0;

  // Chunked bulk INSERT — RETURNING id preserves VALUES order in Postgres
  // (and PGlite), so we can zip inserted ids back onto their inputs to
  // build the (input → new tx id) map used by the splits fan-out below.
  const insertedIds: number[] = [];
  for (let i = 0; i < rows.length; i += RESTORE_TX_CHUNK) {
    const slice = rows.slice(i, i + RESTORE_TX_CHUNK);
    const returned = await tx
      .insert(transactions)
      .values(slice.map((r) => r.values))
      .returning({ id: transactions.id });
    for (const r of returned) insertedIds.push(r.id);
  }

  // Bulk INSERT every split row from every restored parent. Same
  // chunking so the wire payload stays bounded on very large libraries.
  const splitRows: Array<typeof transactionSplits.$inferInsert> = [];
  for (let i = 0; i < rows.length; i++) {
    const input = rows[i]!.input;
    const parentId = insertedIds[i]!;
    if (!input.splits || input.splits.length === 0) continue;
    for (const s of input.splits) {
      splitRows.push({
        transactionId: parentId,
        categoryId: resolveCategoryRef(s.category, s.categoryParent, cats.categoryIdByPath, cats.categoryIdsByName),
        amount: s.amount,
        memo: s.memo ?? null,
      });
    }
  }
  for (let i = 0; i < splitRows.length; i += RESTORE_TX_CHUNK) {
    const slice = splitRows.slice(i, i + RESTORE_TX_CHUNK);
    await tx.insert(transactionSplits).values(slice);
  }

  return rows.length;
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
  let goalsSkipped = 0;
  const resolvedGoals: Array<{
    input: NonNullable<BackupDump['savingsGoals']>[number];
    values: typeof savingsGoals.$inferInsert;
  }> = [];
  for (const g of dumpGoals) {
    const accId = resolveNameToId(g.account, accountIdByName);
    if (accId === null) { goalsSkipped++; continue; }
    resolvedGoals.push({
      input: g,
      values: {
        userId: uid,
        accountId: accId,
        name: g.name,
        targetAmount: g.targetAmount,
        targetDate: g.targetDate ?? null,
        color: g.color ?? null,
        closedAt: g.closedAt ? new Date(g.closedAt) : null,
      },
    });
  }
  let goalsInserted = 0;
  for (let i = 0; i < resolvedGoals.length; i += RESTORE_TX_CHUNK) {
    const slice = resolvedGoals.slice(i, i + RESTORE_TX_CHUNK);
    const returned = await tx.insert(savingsGoals).values(slice.map((r) => r.values)).returning({ id: savingsGoals.id });
    for (let j = 0; j < returned.length; j++) {
      goalIdByKey.set(`${slice[j]!.input.account}::${slice[j]!.input.name}`, returned[j]!.id);
    }
    goalsInserted += returned.length;
  }

  const eventRows: Array<typeof savingsGoalEvents.$inferInsert> = [];
  let eventsSkipped = 0;
  for (const e of dumpEvents) {
    const goalId = goalIdByKey.get(`${e.account}::${e.goal}`);
    if (goalId === undefined) { eventsSkipped++; continue; }
    eventRows.push({
      userId: uid,
      goalId,
      amount: e.amount,
      eventDate: e.eventDate,
      note: e.note ?? null,
    });
  }
  for (let i = 0; i < eventRows.length; i += RESTORE_TX_CHUNK) {
    await tx.insert(savingsGoalEvents).values(eventRows.slice(i, i + RESTORE_TX_CHUNK));
  }

  return { goalsInserted, goalsSkipped, eventsInserted: eventRows.length, eventsSkipped };
}
