import type { Category, CategoryReportRow } from '../../api/types';

// Sum of own-category totals across the report window. `category_id == null`
// rows (uncategorized) are skipped — they're rendered separately elsewhere.
export function buildOwnTotalsByCat(report: CategoryReportRow[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of report) {
    if (r.category_id == null) continue;
    const prev = m.get(r.category_id) ?? 0;
    m.set(r.category_id, prev + Number(r.total));
  }
  return m;
}

// Category total including one level of children. Depth is capped at 1
// because the current schema only supports parent/child (no grandchildren).
export function rolledUpTotal(
  cat: Category,
  ownTotals: Map<number, number>,
  childrenByParent: Map<number, Category[]>,
): number {
  let sum = ownTotals.get(cat.id) ?? 0;
  for (const ch of childrenByParent.get(cat.id) ?? []) {
    sum += ownTotals.get(ch.id) ?? 0;
  }
  return sum;
}
