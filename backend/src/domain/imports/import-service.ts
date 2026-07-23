import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  accountFilenamePatterns,
  fileImports,
  transactions,
} from '../../db/schema.js';
import { parseOfx, type ParsedTransaction } from './ofx-parser.js';
import { parseFrenchCsv } from './csv-parser.js';
import { normalizeLabel } from './normalize.js';
import { computeDedupKey } from './dedup.js';
import { loadRuleEngine } from '../rules/recategorize.js';
import { firstMatch } from '../rules/matcher.js';
import { detectTransfers } from '../transfers/detector.js';
import { runRecurringDetectionStandalone } from '../../services/recurring-detect.js';

export type ImportFormat = 'ofx' | 'csv' | 'pdf';

export interface ImportResult {
  fileImportId: number;
  format: ImportFormat;
  accountId: number;
  totalLines: number;
  insertedCount: number;
  dedupSkipped: number;
  insertedIds: number[];
  // Rows the parser produced but the DB dedup-skipped (a matching
  // (account_id, dedup_key) already existed). Surfaced in the import
  // summary so the user can see WHAT was skipped, not just how many.
  dedupSkippedRows: Array<{ date: string; amount: string; rawLabel: string }>;
}

// Pick the destination account from the filename via the configured patterns.
// Returns the highest-priority match; null when no pattern matches.
export async function resolveAccountFromFilename(userId: number, filename: string): Promise<number | null> {
  const patterns = await db
    .select()
    .from(accountFilenamePatterns)
    .where(eq(accountFilenamePatterns.userId, userId))
    .orderBy(desc(accountFilenamePatterns.priority));
  const lower = filename.toLowerCase();
  for (const p of patterns) {
    if (lower.includes(p.pattern.toLowerCase())) return p.accountId;
  }
  return null;
}

export function inferFormat(filename: string): ImportFormat | null {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'ofx' || ext === 'qfx') return 'ofx';
  if (ext === 'csv') return 'csv';
  if (ext === 'pdf') return 'pdf';
  return null;
}

function parseFile(buf: Buffer, format: ImportFormat): ParsedTransaction[] {
  if (format === 'ofx') return parseOfx(buf);
  if (format === 'csv') return parseFrenchCsv(buf);
  throw new Error(`parseFile: format ${format} not handled here`);
}

export async function runImport(opts: {
  filename: string;
  accountId: number;
  userId: number;
  format: ImportFormat;
  buffer?: Buffer;
  prepared?: ParsedTransaction[];
}): Promise<ImportResult> {
  const parsed = opts.prepared ?? parseFile(opts.buffer!, opts.format);

  const result = await db.transaction(async (tx) => {
    const [fileImport] = await tx
      .insert(fileImports)
      .values({
        userId: opts.userId,
        filename: opts.filename,
        accountId: opts.accountId,
        format: opts.format,
        totalLines: parsed.length,
        insertedCount: 0,
        dedupSkipped: 0,
      })
      .returning();

    if (!fileImport) throw new Error('failed to create file_imports row');

    let inserted = 0;
    let skipped = 0;
    const insertedIds: number[] = [];
    const dedupSkippedRows: Array<{ date: string; amount: string; rawLabel: string }> = [];

    for (const p of parsed) {
      const normalizedLabel = normalizeLabel(p.rawLabel);
      const dedupKey = computeDedupKey({
        accountId: opts.accountId,
        date: p.date,
        amount: p.amount,
        normalizedLabel,
        fitid: p.fitid,
      });

      const result = await tx
        .insert(transactions)
        .values({
          userId: opts.userId,
          accountId: opts.accountId,
          date: p.date,
          amount: p.amount,
          rawLabel: p.rawLabel,
          normalizedLabel,
          memo: p.memo,
          fitid: p.fitid,
          dedupKey,
          sourceFileId: fileImport.id,
        })
        .onConflictDoNothing({
          target: [transactions.accountId, transactions.dedupKey],
        })
        .returning({ id: transactions.id });

      if (result.length > 0 && result[0]) {
        inserted++;
        insertedIds.push(result[0].id);
      } else {
        skipped++;
        dedupSkippedRows.push({ date: p.date, amount: p.amount, rawLabel: p.rawLabel });
      }
    }

    await tx
      .update(fileImports)
      .set({ insertedCount: inserted, dedupSkipped: skipped })
      .where(eq(fileImports.id, fileImport.id));

    // Transfer detection runs *before* categorization so transfer legs end up
    // with categoryId = null (and category_source = 'auto'); the rule engine
    // then skips them because the bucketing code below only processes rows
    // still in `insertedIds` that aren't linked.
    if (insertedIds.length > 0) {
      await detectTransfers(tx, opts.userId, insertedIds);
    }

    // Apply the rule engine to freshly inserted rows. We do this *inside* the
    // import transaction so an import either lands fully categorized or not at all.
    if (insertedIds.length > 0) {
      const { compiled, defaultId } = await loadRuleEngine(opts.userId);

      const freshRows = await tx
        .select({
          id: transactions.id,
          amount: transactions.amount,
          normalizedLabel: transactions.normalizedLabel,
          transferGroupId: transactions.transferGroupId,
        })
        .from(transactions)
        .where(inArray(transactions.id, insertedIds));

      const autoBuckets = new Map<number, number[]>();
      const defaultBucket: number[] = [];
      for (const row of freshRows) {
        // Skip transfer legs — they don't get a category.
        if (row.transferGroupId) continue;
        const amount = Number(row.amount);
        const hit = firstMatch(compiled, row.normalizedLabel, amount);
        if (hit) {
          const arr = autoBuckets.get(hit.rule.categoryId) ?? [];
          arr.push(row.id);
          autoBuckets.set(hit.rule.categoryId, arr);
        } else {
          defaultBucket.push(row.id);
        }
      }

      for (const [categoryId, ids] of autoBuckets) {
        await tx
          .update(transactions)
          .set({ categoryId, categorySource: 'auto' })
          .where(inArray(transactions.id, ids));
      }
      if (defaultBucket.length > 0 && defaultId !== null) {
        await tx
          .update(transactions)
          .set({ categoryId: defaultId, categorySource: 'default' })
          .where(inArray(transactions.id, defaultBucket));
      }
    }

    return {
      fileImportId: fileImport.id,
      format: opts.format,
      accountId: opts.accountId,
      totalLines: parsed.length,
      insertedCount: inserted,
      dedupSkipped: skipped,
      insertedIds,
      dedupSkippedRows,
    };
  });

  // Recurring-series detection was previously awaited inside the import
  // transaction — clustering the last 12 months of transactions on PGlite
  // (single-threaded WASM) can take many seconds on a 500-row import,
  // during which the /api/imports request never responds and the UI stays
  // stuck on the preview modal. Kick it off fire-and-forget instead; it
  // gets its own transaction (runRecurringDetectionStandalone) and users
  // can also trigger a refresh manually via POST /api/recurring/regenerate.
  runRecurringDetectionStandalone(opts.userId).catch((err) => {
    console.error('[imports] background recurring detection failed', err);
  });

  return result;
}
