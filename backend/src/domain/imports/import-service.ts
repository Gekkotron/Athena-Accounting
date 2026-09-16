import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accountFilenamePatterns } from '../../db/schema.js';
import { parseOfx, type ParsedTransaction } from './ofx-parser.js';
import { parseFrenchCsv } from './csv-parser.js';
import { parseCamt } from './camt-parser.js';
import type { ImportFormat, ImportResult } from './import-service-types.js';
import { runImportTransaction } from './run-import-transaction.js';
import { runPostCommitFanOut } from './post-commit-fan-out.js';
import { trace } from './import-trace.js';

export type { ImportFormat, ImportResult } from './import-service-types.js';

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

// 'bank-sync' is excluded: it is not a file format — only the sync engine
// passes it, always with `prepared` rows.
export function inferFormat(filename: string): Exclude<ImportFormat, 'bank-sync'> | null {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'ofx' || ext === 'qfx') return 'ofx';
  if (ext === 'csv') return 'csv';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xml') return 'camt';
  return null;
}

function parseFile(buf: Buffer, format: ImportFormat): ParsedTransaction[] {
  if (format === 'ofx') return parseOfx(buf);
  if (format === 'csv') return parseFrenchCsv(buf);
  if (format === 'camt') return parseCamt(buf);
  throw new Error(`parseFile: format ${format} not handled here`);
}

export async function runImport(opts: {
  filename: string;
  accountId: number;
  userId: number;
  format: ImportFormat;
  buffer?: Buffer;
  prepared?: ParsedTransaction[];
  skipParsedIndices?: number[];
}): Promise<ImportResult> {
  const tStart = Date.now();
  const parsed = opts.prepared ?? parseFile(opts.buffer!, opts.format);
  const tParsed = Date.now();
  trace(`start file=${opts.filename} parsed=${parsed.length} parse=${tParsed - tStart}ms`);

  const skipSet = new Set<number>();
  if (opts.skipParsedIndices) {
    for (const n of opts.skipParsedIndices) {
      if (Number.isInteger(n) && n >= 0 && n < parsed.length) skipSet.add(n);
    }
  }
  const userSkipped = skipSet.size;

  const result = await runImportTransaction(opts, parsed, userSkipped, skipSet);
  trace('tx: committed');

  const tCommitted = Date.now();
  trace(
    `done file=${opts.filename} inserted=${result.insertedCount} ` +
    `deduped=${result.dedupSkipped} user-skipped=${result.userSkipped} ` +
    `parse=${tParsed - tStart}ms tx=${tCommitted - tParsed}ms total=${tCommitted - tStart}ms`,
  );

  await runPostCommitFanOut(opts, result.insertedIds, tCommitted);

  return result;
}
