import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { transactions } from '../../db/schema.js';
import {
  jaccardTokenSimilarity,
  tokenize,
} from '../../lib/label-similarity.js';

// Locked in the design (see docs/superpowers/specs/2026-08-20-fuzzy-import-dedup-design.md, D1).
export const MAX_DAY_DELTA = 3;
export const MAX_AMOUNT_DELTA = 0.02;
export const LABEL_JACCARD_THRESHOLD = 0.5;

export interface FuzzyCandidate {
  txId?: number;
  date: string;
  amount: string;
  normalizedLabel: string;
  rawLabel: string;
}

export interface ScoredMatch {
  candidate: FuzzyCandidate;
  jaccard: number;
}

// jaccardTokenSimilarity('', '') === 1 by design (it powers recurring-series
// clustering, where "no label" is a legitimate cluster key). For dedup we want
// the opposite: two rows with no extractable label content give us zero
// signal, so they must not fuzzy-match on date+amount alone.
export function hasLabelSignal(row: { rawLabel: string }): boolean {
  return tokenize(row.rawLabel).size > 0;
}

function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.abs(ta - tb) / 86_400_000;
}

function sameSign(a: string, b: string): boolean {
  const sa = a.startsWith('-');
  const sb = b.startsWith('-');
  return sa === sb;
}

export function passesHardWindows(a: FuzzyCandidate, b: FuzzyCandidate): boolean {
  if (!sameSign(a.amount, b.amount)) return false;
  if (diffDays(a.date, b.date) > MAX_DAY_DELTA) return false;
  const na = Number(a.amount);
  const nb = Number(b.amount);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  if (Math.abs(na - nb) > MAX_AMOUNT_DELTA + 1e-9) return false;
  return true;
}

export function fuzzyMatchesPair(a: FuzzyCandidate, b: FuzzyCandidate): boolean {
  if (!passesHardWindows(a, b)) return false;
  if (!hasLabelSignal(a) || !hasLabelSignal(b)) return false;
  return jaccardTokenSimilarity(a.rawLabel, b.rawLabel) >= LABEL_JACCARD_THRESHOLD;
}

// Batch entry: one range SQL narrows same-account candidates by
// (date, amount) window, then JS scores by Jaccard and drops the ones
// below LABEL_JACCARD_THRESHOLD. Returns a map keyed by the incoming row
// index; missing key means "no fuzzy match". Each value is sorted by
// Jaccard descending so callers cheaply slice a top-N.
export async function findFuzzyMatches(opts: {
  accountId: number;
  userId: number;
  incoming: FuzzyCandidate[];
}): Promise<Map<number, ScoredMatch[]>> {
  const result = new Map<number, ScoredMatch[]>();
  if (opts.incoming.length === 0) return result;

  let minDate = opts.incoming[0]!.date;
  let maxDate = opts.incoming[0]!.date;
  let minAmount = Number(opts.incoming[0]!.amount);
  let maxAmount = minAmount;
  for (const r of opts.incoming) {
    if (r.date < minDate) minDate = r.date;
    if (r.date > maxDate) maxDate = r.date;
    const n = Number(r.amount);
    if (n < minAmount) minAmount = n;
    if (n > maxAmount) maxAmount = n;
  }

  const dateLo = shiftIso(minDate, -MAX_DAY_DELTA);
  const dateHi = shiftIso(maxDate, MAX_DAY_DELTA);
  const amountLo = (minAmount - MAX_AMOUNT_DELTA).toFixed(2);
  const amountHi = (maxAmount + MAX_AMOUNT_DELTA).toFixed(2);

  const candidates = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      rawLabel: transactions.rawLabel,
      normalizedLabel: transactions.normalizedLabel,
    })
    .from(transactions)
    .where(and(
      eq(transactions.userId, opts.userId),
      eq(transactions.accountId, opts.accountId),
      isNull(transactions.transferGroupId),
      gte(transactions.date, dateLo),
      lte(transactions.date, dateHi),
      sql`${transactions.amount}::numeric BETWEEN ${amountLo} AND ${amountHi}`,
    ));

  for (const existing of candidates) {
    const eCand: FuzzyCandidate = {
      txId: existing.id,
      date: existing.date,
      amount: existing.amount,
      rawLabel: existing.rawLabel,
      normalizedLabel: existing.normalizedLabel,
    };
    for (let i = 0; i < opts.incoming.length; i++) {
      const inc = opts.incoming[i]!;
      if (!passesHardWindows(inc, eCand)) continue;
      if (!hasLabelSignal(inc) || !hasLabelSignal(eCand)) continue;
      const score = jaccardTokenSimilarity(inc.rawLabel, eCand.rawLabel);
      if (score < LABEL_JACCARD_THRESHOLD) continue;
      const list = result.get(i) ?? [];
      list.push({ candidate: eCand, jaccard: score });
      result.set(i, list);
    }
  }

  for (const list of result.values()) list.sort((a, b) => b.jaccard - a.jaccard);
  return result;
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
