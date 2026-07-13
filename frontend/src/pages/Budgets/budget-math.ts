import type { BudgetReport, Category } from '../../api/types';

export function normalizeSparkline(values: string[]): Array<{ height: number; isCurrent: boolean }> {
  if (values.length === 0) return [];
  const nums = values.map((v) => Number(v));
  const max = Math.max(...nums);
  return nums.map((n, i) => ({
    height: max > 0 ? n / max : 0,
    isCurrent: i === nums.length - 1,
  }));
}

export function summarizePace(totals: BudgetReport['totals']): 'over' | 'onTrack' | 'unknown' {
  if (totals.projected == null) return 'unknown';
  return Number(totals.projected) > Number(totals.limit) ? 'over' : 'onTrack';
}

// Returns the subset of report rows to sum for the summary: keep only rows
// whose category is NOT itself a child of another budgeted category. Prevents
// double-counting when both a parent (e.g. "Alimentation") and its child
// (e.g. "Restaurants") carry independent budgets — the parent's rolled-up
// spend already includes the child's spend, so summing both is wrong.
//
// The backend (`/api/reports/budget`'s totals) now applies the equivalent
// filter server-side, so `report.data.totals` itself is already correct.
// This client-side filter is kept as defense-in-depth (and because the
// SummaryCard's mini-chart re-derives its bars from `rows`, not `totals`) —
// if a future backend change ever regresses the server-side filter, the UI
// still won't double-count.
export function topLevelRows(
  rows: BudgetReport['rows'],
  categories: Category[],
): BudgetReport['rows'] {
  const budgetedCategoryIds = new Set(rows.map((r) => r.categoryId));
  const parentByChildId = new Map<number, number | null>();
  for (const c of categories) parentByChildId.set(c.id, c.parentId ?? null);
  return rows.filter((r) => {
    const parent = parentByChildId.get(r.categoryId) ?? null;
    return parent == null || !budgetedCategoryIds.has(parent);
  });
}
