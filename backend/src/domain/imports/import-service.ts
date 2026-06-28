import { desc, eq } from 'drizzle-orm';
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

export type ImportFormat = 'ofx' | 'csv';

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
  return null;
}

function parseFile(buf: Buffer, format: ImportFormat): ParsedTransaction[] {
  if (format === 'ofx') return parseOfx(buf);
  return parseFrenchCsv(buf);
}

export async function runImport(opts: {
  filename: string;
  accountId: number;
  format: ImportFormat;
  buffer: Buffer;
}): Promise<ImportResult> {
  const parsed = parseFile(opts.buffer, opts.format);

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
