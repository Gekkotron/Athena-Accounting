import { jaccardTokenSimilarity, tokenize } from '../../lib/label-similarity.js';

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
