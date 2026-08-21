import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { transactions } from '../../db/schema.js';
import { parseOfx, type ParsedTransaction } from './ofx-parser.js';
import { parseFrenchCsv } from './csv-parser.js';
import { parseCamt } from './camt-parser.js';
import { normalizeLabel } from './normalize.js';
import { computeDedupKey } from './dedup.js';
import { findFuzzyMatches, type FuzzyCandidate } from '../dedup/fuzzy-match.js';

export type PreviewFormat = 'ofx' | 'csv' | 'camt';

export interface PreviewRow {
  date: string;
  amount: string;
  rawLabel: string;
  memo: string | null;
}

export interface FuzzyDuplicatePreviewRow {
  row: PreviewRow;
  parsedIndex: number;
  matches: Array<{
    txId: number;
    date: string;
    amount: string;
    rawLabel: string;
  }>;
}

export interface PreviewResult {
  filename: string;
  format: PreviewFormat;
  accountId: number;
  totalRows: number;
  newRows: PreviewRow[];
  duplicateRows: PreviewRow[];
  fuzzyDuplicateRows: FuzzyDuplicatePreviewRow[];
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
      fuzzyDuplicateRows: [],
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

  // Partition parsed rows against the hard dedup key first.
  const duplicateRows: PreviewRow[] = [];
  const newParsedIndices: number[] = [];
  const newFuzzyInput: FuzzyCandidate[] = [];
  for (let i = 0; i < withKeys.length; i++) {
    const w = withKeys[i]!;
    if (seen.has(w.dedupKey)) {
      duplicateRows.push(w.row);
      continue;
    }
    newParsedIndices.push(i);
    newFuzzyInput.push({
      date: w.row.date,
      amount: w.row.amount,
      rawLabel: w.row.rawLabel,
      normalizedLabel: normalizeLabel(w.row.rawLabel),
    });
  }

  const fuzzyMap = await findFuzzyMatches({
    accountId: opts.accountId,
    userId: opts.userId,
    incoming: newFuzzyInput,
  });

  const newRows: PreviewRow[] = [];
  const fuzzyDuplicateRows: FuzzyDuplicatePreviewRow[] = [];
  for (let idx = 0; idx < newFuzzyInput.length; idx++) {
    const parsedIndex = newParsedIndices[idx]!;
    const row = withKeys[parsedIndex]!.row;
    const matches = fuzzyMap.get(idx);
    if (!matches || matches.length === 0) {
      newRows.push(row);
      continue;
    }
    fuzzyDuplicateRows.push({
      row,
      parsedIndex,
      matches: matches.slice(0, 3).map((m) => ({
        txId: m.candidate.txId!,
        date: m.candidate.date,
        amount: m.candidate.amount,
        rawLabel: m.candidate.rawLabel,
      })),
    });
  }

  return {
    filename: opts.filename,
    format: opts.format,
    accountId: opts.accountId,
    totalRows: parsed.length,
    newRows,
    duplicateRows,
    fuzzyDuplicateRows,
  };
}
