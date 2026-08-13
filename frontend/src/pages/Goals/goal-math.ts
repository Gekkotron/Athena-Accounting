import type { SavingsGoal } from '../../api/types';

// Colour band for the progress bar. Mirrors the Budgets caps convention:
// green under 80 %, amber 80–100 %, red over target. Decided off `rawPct`
// so overshoots read red rather than settling at 100 %.
export function colorBand(rawPct: number): 'green' | 'amber' | 'red' {
  if (rawPct >= 100) return 'red';
  if (rawPct >= 80) return 'amber';
  return 'green';
}

// Pure recompute of the projection columns from a goal + its saved sum +
// today. Same logic as the backend list.ts computeProjection so demo mode
// gives users the same numbers they'd see hitting a real backend.
export function computeProjection(opts: {
  target: number;
  saved: number;
  targetDate: string | null;
  todayIso: string;
}): { rawPct: number; progressPct: number; perMonthNeeded: string | null; overdueDays: number | null } {
  const target = opts.target;
  const saved = opts.saved;
  const rawPct = target > 0 ? (saved / target) * 100 : 0;
  const progressPct = Math.max(0, Math.min(100, rawPct));

  if (!opts.targetDate) return { rawPct, progressPct, perMonthNeeded: null, overdueDays: null };

  const target0 = new Date(`${opts.targetDate}T00:00:00Z`).getTime();
  const today0 = new Date(`${opts.todayIso}T00:00:00Z`).getTime();
  const dayMs = 86_400_000;

  if (target0 <= today0) {
    if (saved >= target) return { rawPct, progressPct, perMonthNeeded: null, overdueDays: null };
    const overdueDays = Math.floor((today0 - target0) / dayMs);
    return { rawPct, progressPct, perMonthNeeded: null, overdueDays };
  }

  const remaining = target - saved;
  if (remaining <= 0) return { rawPct, progressPct, perMonthNeeded: '0.00', overdueDays: null };
  const monthsRemaining = Math.max((target0 - today0) / dayMs / 30.44, 1e-9);
  const perMonth = Math.ceil(remaining / monthsRemaining);
  return { rawPct, progressPct, perMonthNeeded: perMonth.toFixed(2), overdueDays: null };
}

// Client-side sort helper for the Dashboard section: soonest deadline first,
// nulls last, tie-break on lowest rawPct (least-full goal wins so the user
// sees the more urgent one).
export function sortBySoonest(a: SavingsGoal, b: SavingsGoal): number {
  const ad = a.targetDate ?? '';
  const bd = b.targetDate ?? '';
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.rawPct - b.rawPct;
}
