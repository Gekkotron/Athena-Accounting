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

export type ImportFormat = 'ofx' | 'csv' | 'pdf';

export interface ImportResult {
  fileImportId: number;
  format: ImportFormat;
  accountId: number;
  totalLines: number;
  insertedCount: number;
  dedupSkipped: number;
  insertedIds: number[];
}

// Pick the destination account from the filename via the configured patterns.
// Returns the highest-priority match; null when no pattern matches.
export async function resolveAccountFromFilename(filename: string): Promise<number | null> {
  const patterns = await db
    .select()
    .from(accountFilenamePatterns)
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
  format: ImportFormat;
  buffer?: Buffer;
  prepared?: ParsedTransaction[];
}): Promise<ImportResult> {
  const parsed = opts.prepared ?? parseFile(opts.buffer!, opts.format);

  return await db.transaction(async (tx) => {
    const [fileImport] = await tx
      .insert(fileImports)
      .values({
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
      await detectTransfers(tx, insertedIds);
    }

    // Apply the rule engine to freshly inserted rows. We do this *inside* the
    // import transaction so an import either lands fully categorized or not at all.
    if (insertedIds.length > 0) {
      const { compiled, defaultId } = await loadRuleEngine();

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
    };
  });
}
