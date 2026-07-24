import { and, gte, isNull, lte, or, sql, eq, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { transactions, transactionSplits } from '../../../db/schema.js';
import type { ListQuery } from './schemas.js';
import { buildAmountRange } from './helpers.js';

// The single source of truth for what "the current filter" means. Both the
// paginated list and the CSV export build their WHERE from here, so a filter
// added to one can never silently miss the other.
export function buildListWhere(uid: number, q: z.infer<typeof ListQuery>): SQL[] {
  const where: SQL[] = [eq(transactions.userId, uid)];
  if (q.accountId) where.push(eq(transactions.accountId, q.accountId));
  if (q.categoryId) {
    // Match plain-category transactions OR transactions with any split
    // targeting the wanted category. Keeps the "Livres" filter honest
    // when a Livres split lives on an Amazon transaction whose own
    // category_id points elsewhere (or is null).
    where.push(sql`(
      ${transactions.categoryId} = ${q.categoryId}
      OR EXISTS (
        SELECT 1 FROM ${transactionSplits} s
         WHERE s.transaction_id = ${transactions.id}
           AND s.category_id = ${q.categoryId}
      )
    )`);
  }
  if (q.sourceFileId) where.push(eq(transactions.sourceFileId, q.sourceFileId));
  if (q.fromDate) where.push(gte(transactions.date, q.fromDate));
  if (q.toDate) where.push(lte(transactions.date, q.toDate));
  if (q.minAmount) where.push(gte(transactions.amount, q.minAmount));
  if (q.maxAmount) where.push(lte(transactions.amount, q.maxAmount));
  if (q.amount) {
    // Sign-agnostic match — both the credit and the debit — which is what
    // the user usually means by "find 338€". Missing decimals widen: "19"
    // → 19.00–19.99 (finds 19.72), "55.5" → 55.50–55.59 (finds 55.57), so
    // the results keep updating while the user is still typing. Typing the
    // full cents ("19.72") collapses to an exact match, which is what
    // reconciliation against a known écart needs.
    const { lo, hi } = buildAmountRange(q.amount.replace(/^-/, ''));
    const cond = or(
      and(gte(transactions.amount, lo), lte(transactions.amount, hi)),
      and(gte(transactions.amount, `-${hi}`), lte(transactions.amount, `-${lo}`)),
    );
    if (cond) where.push(cond);
  }
  if (!q.includeTransfers) where.push(isNull(transactions.transferGroupId));

  if (q.search) {
    // Substring match across every user-facing text field, accent- and
    // case-insensitive. Four seq-scan LIKE branches — acceptable at
    // homelab scale (~<10k rows). If perf hurts, promote to a generated
    // column + GIN trigram index (see TODO.md).
    const needle = sql`immutable_unaccent(lower(${q.search}))`;
    where.push(sql`(
      immutable_unaccent(lower(${transactions.rawLabel})) LIKE '%' || ${needle} || '%'
      OR immutable_unaccent(lower(${transactions.normalizedLabel})) LIKE '%' || ${needle} || '%'
      OR immutable_unaccent(lower(coalesce(${transactions.memo}, ''))) LIKE '%' || ${needle} || '%'
      OR immutable_unaccent(lower(coalesce(${transactions.notes}, ''))) LIKE '%' || ${needle} || '%'
    )`);
  }

  return where;
}
