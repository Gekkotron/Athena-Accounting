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

// Unbuffered progress logger. console.log on Node routes through stdout which
// is block-buffered when piped (Tauri sidecar) — a stuck transaction can leave
// its last few logs invisible in the buffer. process.stderr on Node is
// synchronous when piped, so every line reaches the parent process
// immediately. Prefixed for grep-ability in the sidecar output.
function trace(msg: string): void {
  try {
    process.stderr.write(`[imports:trace] ${msg}\n`);
  } catch {
    // Never let logging failure break an import.
  }
}

// PGlite bulk INSERT with hundreds of rows in one shot has been observed to
// stall in some driver/version combinations. Chunk so no single INSERT
// carries more than this many rows; kept small enough to be safely under
// any postgres 16-bit-parameter limit and to keep progress logging useful.
const INSERT_CHUNK_SIZE = 100;

export async function runImport(opts: {
  filename: string;
  accountId: number;
  userId: number;
  format: ImportFormat;
  buffer?: Buffer;
  prepared?: ParsedTransaction[];
}): Promise<ImportResult> {
  const tStart = Date.now();
  const parsed = opts.prepared ?? parseFile(opts.buffer!, opts.format);
  const tParsed = Date.now();
  trace(`start file=${opts.filename} parsed=${parsed.length} parse=${tParsed - tStart}ms`);

  const result = await db.transaction(async (tx) => {
    trace('tx: begin');
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
    trace(`tx: fileImport row id=${fileImport.id}`);

    let inserted = 0;
    let skipped = 0;
    const insertedIds: number[] = [];
    const dedupSkippedRows: Array<{ date: string; amount: string; rawLabel: string }> = [];

    // Pre-compute normalization + dedup keys once, JS-side, then chunk the
    // INSERTs. Per-row was 474 round-trips = 20+s on PGlite; a single 474-row
    // bulk INSERT hung silently; chunking splits the difference: ~5 INSERTs of
    // 100 rows each, each with its own trace line so a stuck chunk is
    // pinpointed by the last visible log.
    if (parsed.length > 0) {
      trace(`prep: normalizing + computing dedup keys for ${parsed.length} rows`);
      const rowValues = parsed.map((p) => {
        const normalizedLabel = normalizeLabel(p.rawLabel);
        const dedupKey = computeDedupKey({
          accountId: opts.accountId,
          date: p.date,
          amount: p.amount,
          normalizedLabel,
          fitid: p.fitid,
        });
        return {
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
        };
      });
      trace('prep: done');

      const insertedByKey = new Map<string, number>();
      for (let start = 0; start < rowValues.length; start += INSERT_CHUNK_SIZE) {
        const chunk = rowValues.slice(start, start + INSERT_CHUNK_SIZE);
        const tChunkStart = Date.now();
        trace(`insert: chunk ${start}..${start + chunk.length - 1} (${chunk.length} rows) begin`);
        const insertedRows = await tx
          .insert(transactions)
          .values(chunk)
          .onConflictDoNothing({
            target: [transactions.accountId, transactions.dedupKey],
          })
          .returning({ id: transactions.id, dedupKey: transactions.dedupKey });
        for (const r of insertedRows) insertedByKey.set(r.dedupKey, r.id);
        trace(
          `insert: chunk ${start}..${start + chunk.length - 1} end ` +
          `inserted=${insertedRows.length}/${chunk.length} ` +
          `elapsed=${Date.now() - tChunkStart}ms`,
        );
      }

      trace('match: reconciling inserted vs skipped');
      for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i]!;
        const key = rowValues[i]!.dedupKey;
        const id = insertedByKey.get(key);
        if (id !== undefined) {
          inserted++;
          insertedIds.push(id);
          insertedByKey.delete(key);
        } else {
          skipped++;
          dedupSkippedRows.push({ date: p.date, amount: p.amount, rawLabel: p.rawLabel });
        }
      }
      trace(`match: done inserted=${inserted} skipped=${skipped}`);
    }

    trace('tx: updating file_imports counts');
    await tx
      .update(fileImports)
      .set({ insertedCount: inserted, dedupSkipped: skipped })
      .where(eq(fileImports.id, fileImport.id));

    // Transfer detection runs *before* categorization so transfer legs end up
    // with categoryId = null (and category_source = 'auto'); the rule engine
    // then skips them because the bucketing code below only processes rows
    // still in `insertedIds` that aren't linked.
    if (insertedIds.length > 0) {
      trace(`tx: detectTransfers over ${insertedIds.length} rows`);
      await detectTransfers(tx, opts.userId, insertedIds);
      trace('tx: detectTransfers done');
    }

    // Apply the rule engine to freshly inserted rows. We do this *inside* the
    // import transaction so an import either lands fully categorized or not at all.
    if (insertedIds.length > 0) {
      trace('tx: loading rule engine');
      // Pass `tx` explicitly — loadRuleEngine defaults to the top-level `db`
      // client, which on PGlite would deadlock waiting for the connection
      // that this very transaction is holding.
      const { compiled, defaultId } = await loadRuleEngine(opts.userId, tx);
      trace(`tx: rule engine loaded (${compiled.length} rules, defaultId=${defaultId ?? 'null'})`);

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

      trace(`tx: applying categories (autoBuckets=${autoBuckets.size}, defaultBucket=${defaultBucket.length})`);
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
      trace('tx: categories applied');
    }

    trace('tx: about to commit');
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
  trace('tx: committed');

  const tCommitted = Date.now();
  trace(
    `done file=${opts.filename} inserted=${result.insertedCount} ` +
    `skipped=${result.dedupSkipped} parse=${tParsed - tStart}ms ` +
    `tx=${tCommitted - tParsed}ms total=${tCommitted - tStart}ms`,
  );

  // Recurring-series detection was previously awaited inside the import
  // transaction — clustering the last 12 months of transactions on PGlite
  // (single-threaded WASM) can take many seconds on a 500-row import,
  // during which the /api/imports request never responds and the UI stays
  // stuck on the preview modal. Kick it off fire-and-forget instead; it
  // gets its own transaction (runRecurringDetectionStandalone) and users
  // can also trigger a refresh manually via POST /api/recurring/regenerate.
  runRecurringDetectionStandalone(opts.userId)
    .then((r) => {
      trace(`recurring detection: detected=${r.detected} refreshed=${r.refreshed} elapsed=${Date.now() - tCommitted}ms`);
    })
    .catch((err) => {
      trace(`recurring detection FAILED: ${err instanceof Error ? err.message : String(err)}`);
    });

  return result;
}
