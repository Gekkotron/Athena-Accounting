import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { transactions, transferRules } from '../../db/schema.js';

// How wide is the time window when looking for the mirror leg of a transfer?
// 7 calendar days is generous enough for slow inter-bank wires while still
// avoiding false matches between unrelated transactions of the same amount.
const MIRROR_WINDOW_DAYS = 7;

const ACCENT_RE = /[̀-ͯ]/g;
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(ACCENT_RE, '');
}

function addDays(iso: string, days: number): string {
  // iso is YYYY-MM-DD. Plain date math via the Date constructor in UTC.
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function negate(amount: string): string {
  return amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
}

export interface TransferDetectionResult {
  linked: number;
  legsAnnotated: number;
}

// Pass the tx-aware drizzle handle so the detector runs inside the import
// transaction.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = PgTransaction<any, any, any>;

export async function detectTransfers(
  tx: Tx,
  userId: number,
  insertedTxIds: number[],
): Promise<TransferDetectionResult> {
  if (insertedTxIds.length === 0) return { linked: 0, legsAnnotated: 0 };

  const allRules = await tx
    .select()
    .from(transferRules)
    .where(and(eq(transferRules.userId, userId), eq(transferRules.enabled, true)));

  if (allRules.length === 0) return { linked: 0, legsAnnotated: 0 };

  const folded = allRules.map((r) => ({ ...r, keywordFolded: fold(r.keyword) }));

  // Pull the freshly inserted transactions; we only annotate these.
  const fresh = await tx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      date: transactions.date,
      amount: transactions.amount,
      rawLabel: transactions.rawLabel,
      transferGroupId: transactions.transferGroupId,
    })
    .from(transactions)
    .where(inArray(transactions.id, insertedTxIds));

  let linked = 0;
  let legsAnnotated = 0;

  for (const row of fresh) {
    if (row.transferGroupId) continue;

    const labelFolded = fold(row.rawLabel);
    const matched = folded.find((r) => labelFolded.includes(r.keywordFolded));
    if (!matched) continue;

    legsAnnotated++;

    // The expected mirror has the opposite sign and lives on the counterpart
    // account (when specified) or any *other* account otherwise.
    const mirrorAmount = negate(row.amount);
    const windowStart = addDays(row.date, -MIRROR_WINDOW_DAYS);
    const windowEnd = addDays(row.date, MIRROR_WINDOW_DAYS);

    const accountFilter = matched.counterpartAccountId
      ? eq(transactions.accountId, matched.counterpartAccountId)
      : ne(transactions.accountId, row.accountId);

    const mirrors = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          accountFilter,
          eq(transactions.amount, mirrorAmount),
          gte(transactions.date, windowStart),
          lte(transactions.date, windowEnd),
          isNull(transactions.transferGroupId),
          ne(transactions.id, row.id),
        ),
      )
      .orderBy(sql`abs(EXTRACT(EPOCH FROM (${transactions.date}::timestamp - ${row.date}::timestamp)))`)
      .limit(1);

    const mirror = mirrors[0];
    if (!mirror) continue;

    const groupId = randomUUID();
    await tx
      .update(transactions)
      .set({ transferGroupId: groupId, categoryId: null, categorySource: 'auto' })
      .where(or(eq(transactions.id, row.id), eq(transactions.id, mirror.id)));

    linked++;
  }

  return { linked, legsAnnotated };
}
