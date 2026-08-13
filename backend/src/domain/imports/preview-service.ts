import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { transactions } from '../../db/schema.js';
import { parseOfx, type ParsedTransaction } from './ofx-parser.js';
import { parseFrenchCsv } from './csv-parser.js';
import { parseCamt } from './camt-parser.js';
import { normalizeLabel } from './normalize.js';
import { computeDedupKey } from './dedup.js';

export type PreviewFormat = 'ofx' | 'csv' | 'camt';

export interface PreviewRow {
  date: string;
  amount: string;
  rawLabel: string;
  memo: string | null;
}

export interface PreviewResult {
  filename: string;
  format: PreviewFormat;
  accountId: number;
  totalRows: number;
  newRows: PreviewRow[];
  duplicateRows: PreviewRow[];
}

function parse(buf: Buffer, format: PreviewFormat): ParsedTransaction[] {
  if (format === 'ofx') return parseOfx(buf);
  if (format === 'csv') return parseFrenchCsv(buf);
  return parseCamt(buf);
}

export async function previewImport(opts: {
  filename: string;
  accountId: number;
  userId: number;
  format: PreviewFormat;
  buffer: Buffer;
}): Promise<PreviewResult> {
  const parsed = parse(opts.buffer, opts.format);
  if (parsed.length === 0) {
    return {
      filename: opts.filename,
      format: opts.format,
      accountId: opts.accountId,
      totalRows: 0,
      newRows: [],
      duplicateRows: [],
    };
  }

  const withKeys = parsed.map((p) => ({
    row: {
      date: p.date,
      amount: p.amount,
      rawLabel: p.rawLabel,
      memo: p.memo,
    } satisfies PreviewRow,
    dedupKey: computeDedupKey({
      accountId: opts.accountId,
      date: p.date,
      amount: p.amount,
      normalizedLabel: normalizeLabel(p.rawLabel),
      fitid: p.fitid,
    }),
  }));

  const existing = await db
    .select({ dedupKey: transactions.dedupKey })
    .from(transactions)
    .where(and(
      eq(transactions.accountId, opts.accountId),
      inArray(transactions.dedupKey, withKeys.map((w) => w.dedupKey)),
    ));
  const seen = new Set(existing.map((r) => r.dedupKey));

  const newRows: PreviewRow[] = [];
  const duplicateRows: PreviewRow[] = [];
  for (const w of withKeys) {
    if (seen.has(w.dedupKey)) duplicateRows.push(w.row);
    else newRows.push(w.row);
  }

  return {
    filename: opts.filename,
    format: opts.format,
    accountId: opts.accountId,
    totalRows: parsed.length,
    newRows,
    duplicateRows,
  };
}
