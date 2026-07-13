import type { BudgetReport } from '../../api/types';

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
