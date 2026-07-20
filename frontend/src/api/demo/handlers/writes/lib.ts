import type { Rule, Transaction } from '../../../types';

// Auto-increment id: max existing + 1, or 1 for an empty list.
export function nextId<T extends { id: number }>(rows: T[]): number {
  return rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
}

// Whether a rule matches a transaction. Mirrors the backend evaluator:
// sign constraint (any/positive/negative) + match mode (substring on
// normalized label / regex on raw label, case-insensitive).
export function matchesRule(t: Transaction, r: Rule): boolean {
  if (!r.enabled) return false;
  if (r.signConstraint === 'negative' && Number(t.amount) >= 0) return false;
  if (r.signConstraint === 'positive' && Number(t.amount) <= 0) return false;
  if (r.matchMode === 'regex') {
    try { return new RegExp(r.keyword, 'i').test(t.rawLabel); } catch { return false; }
  }
  return t.normalizedLabel.includes(r.keyword.toLowerCase());
}
