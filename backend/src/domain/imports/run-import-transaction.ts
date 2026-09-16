import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fileImports, transactions } from '../../db/schema.js';
import { normalizeLabel } from './normalize.js';
import { computeDedupKey } from './dedup.js';
import { emitAutoSplits, loadRuleEngine } from '../rules/recategorize.js';
import { firstMatch } from '../rules/matcher.js';
import type { ParsedTransaction } from './ofx-parser.js';
import type { ImportFormat, ImportResult } from './import-service-types.js';
import { autoHealOpeningDate } from './opening-date-autoheal.js';
import { trace } from './import-trace.js';

// PGlite bulk INSERT with hundreds of rows in one shot has been observed to
// stall in some driver/version combinations. Chunk so no single INSERT
// carries more than this many rows; kept small enough to be safely under
// any postgres 16-bit-parameter limit and to keep progress logging useful.
const INSERT_CHUNK_SIZE = 100;

export interface RunImportTxOpts {
  filename: string;
  accountId: number;
  userId: number;
  format: ImportFormat;
}

// The whole `db.transaction` body of runImport, extracted so import-service
// stays a thin orchestrator. Same behavior — writes the file_imports row,
// heals opening_date, chunk-inserts transactions with ON CONFLICT DO
// NOTHING, then applies the rule engine — but callable and testable on its
// own. Returns the fully-populated ImportResult; the caller wires up
// post-commit fan-out.
export async function runImportTransaction(
  opts: RunImportTxOpts,
  parsed: ParsedTransaction[],
  userSkipped: number,
  skipSet: Set<number>,
): Promise<ImportResult> {
  return db.transaction(async (tx) => {
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

    await autoHealOpeningDate(tx, opts, parsed, trace);

    let inserted = 0;
    let skipped = 0;
    const insertedIds: number[] = [];
    const dedupSkippedRows: Array<{ date: string; amount: string; rawLabel: string }> = [];

    if (parsed.length > 0) {
      trace(`prep: normalizing + computing dedup keys for ${parsed.length} rows (skipping ${userSkipped})`);
      const rowValues: Array<{
        userId: number; accountId: number; date: string; amount: string;
        rawLabel: string; normalizedLabel: string; memo: string | null;
        fitid: string | null; dedupKey: string; sourceFileId: number;
      }> = [];
      const parsedIndexForRowValue: number[] = [];
      for (let i = 0; i < parsed.length; i++) {
        if (skipSet.has(i)) continue;
        const p = parsed[i]!;
        const normalizedLabel = normalizeLabel(p.rawLabel);
        const dedupKey = computeDedupKey({
          accountId: opts.accountId, date: p.date, amount: p.amount,
          normalizedLabel, fitid: p.fitid,
        });
        rowValues.push({
          userId: opts.userId, accountId: opts.accountId, date: p.date, amount: p.amount,
          rawLabel: p.rawLabel, normalizedLabel, memo: p.memo, fitid: p.fitid,
          dedupKey, sourceFileId: fileImport.id,
        });
        parsedIndexForRowValue.push(i);
      }
      trace('prep: done');

      const insertedByKey = new Map<string, number>();
      for (let start = 0; start < rowValues.length; start += INSERT_CHUNK_SIZE) {
        const chunk = rowValues.slice(start, start + INSERT_CHUNK_SIZE);
        const tChunkStart = Date.now();
        trace(`insert: chunk ${start}..${start + chunk.length - 1} (${chunk.length} rows) begin`);
        const insertedRows = await tx
          .insert(transactions)
          .values(chunk)
          .onConflictDoNothing({ target: [transactions.accountId, transactions.dedupKey] })
          .returning({ id: transactions.id, dedupKey: transactions.dedupKey });
        for (const r of insertedRows) insertedByKey.set(r.dedupKey, r.id);
        trace(`insert: chunk ${start}..${start + chunk.length - 1} end inserted=${insertedRows.length}/${chunk.length} elapsed=${Date.now() - tChunkStart}ms`);
      }

      trace('match: reconciling inserted vs skipped');
      for (let j = 0; j < rowValues.length; j++) {
        const i = parsedIndexForRowValue[j]!;
        const p = parsed[i]!;
        const key = rowValues[j]!.dedupKey;
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
      .set({ insertedCount: inserted, dedupSkipped: skipped, userSkipped })
      .where(eq(fileImports.id, fileImport.id));

    if (insertedIds.length > 0) {
      trace('tx: loading rule engine');
      // Pass `tx` explicitly — loadRuleEngine defaults to the top-level `db`
      // client, which on PGlite would deadlock waiting for the connection
      // that this very transaction is holding.
      const { compiled, defaultId } = await loadRuleEngine(opts.userId, tx);
      trace(`tx: rule engine loaded (${compiled.length} rules, defaultId=${defaultId ?? 'null'})`);

      const freshRows = await tx
        .select({
          id: transactions.id, amount: transactions.amount,
          normalizedLabel: transactions.normalizedLabel, transferGroupId: transactions.transferGroupId,
        })
        .from(transactions)
        .where(inArray(transactions.id, insertedIds));

      const autoBuckets = new Map<number, number[]>();
      const defaultBucket: number[] = [], splitEmits: Array<{ id: number; amount: number; hit: (typeof compiled)[number] }> = [];
      for (const row of freshRows) {
        if (row.transferGroupId) continue;
        const amount = Number(row.amount);
        const hit = firstMatch(compiled, row.normalizedLabel, amount);
        if (hit && hit.splits && hit.splits.length >= 2) splitEmits.push({ id: row.id, amount, hit });
        else if (hit) {
          const arr = autoBuckets.get(hit.rule.categoryId) ?? [];
          arr.push(row.id);
          autoBuckets.set(hit.rule.categoryId, arr);
        } else defaultBucket.push(row.id);
      }

      trace(`tx: applying categories (auto=${autoBuckets.size}, split=${splitEmits.length}, default=${defaultBucket.length})`);
      if (autoBuckets.size > 0) {
        const parts: ReturnType<typeof sql>[] = [];
        for (const [categoryId, ids] of autoBuckets) for (const id of ids) parts.push(sql`(${id}::bigint, ${categoryId}::int)`);
        await tx.execute(sql`UPDATE transactions AS t SET category_id = m.cat_id, category_source = 'auto' FROM (VALUES ${sql.join(parts, sql`, `)}) AS m(id, cat_id) WHERE t.id = m.id`);
      }
      if (defaultBucket.length > 0 && defaultId !== null) await tx.update(transactions).set({ categoryId: defaultId, categorySource: 'default' }).where(inArray(transactions.id, defaultBucket));
      for (const e of splitEmits) await emitAutoSplits(tx, e.id, e.amount, e.hit);
      trace('tx: categories applied');
    }

    trace('tx: about to commit');
    return {
      fileImportId: fileImport.id, format: opts.format, accountId: opts.accountId,
      totalLines: parsed.length, insertedCount: inserted, dedupSkipped: skipped,
      userSkipped, insertedIds, dedupSkippedRows,
    };
  });
}
