import type { TFunction } from 'i18next';
import type { EnvelopeReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';

export function formatSignedMoney(m: string): string {
  const n = Number(m);
  if (n < 0) return '−' + formatAmount(String(-n));
  return formatAmount(m);
}

// Inclusive month count from `fromYm` up to and including `toYm`.
// Both args are "YYYY-MM". Same month → 1, next month → 2, past → ≤ 0.
function monthsInclusive(fromYm: string, toYm: string): number {
  const [fy, fm] = fromYm.split('-').map(Number) as [number, number];
  const [ty, tm] = toYm.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm) + 1;
}

// Amount to ADD to this envelope's assignment for `currentYm` to stay on track
// toward its target. Returns 0 when there's no target, target already reached,
// or nothing meaningful to add. Semantics per kind:
//   • monthly_recurring — bring this month's assignment up to the recurring
//     amount; never lower a larger user-set assignment.
//   • save_up_to        — fill the shortfall (target − balance) in one shot.
//   • save_by_date      — spread the shortfall over the months still available
//     (this month + any future months up to & including the target month), so
//     clicking repeatedly converges toward "on track" rather than dumping all
//     remaining need in the current month.
// Returned as a JS number in euros; caller decides rounding when serialising.
export function suggestedAssignmentDelta(
  row: Pick<EnvelopeReportRow, 'target' | 'balance' | 'assignment'>,
  currentYm: string,
): number {
  if (!row.target) return 0;
  const targetAmount = Number(row.target.amount);
  if (!(targetAmount > 0)) return 0;
  const balance = Number(row.balance);
  const assignment = Number(row.assignment);

  if (row.target.kind === 'monthly_recurring') {
    return Math.max(0, targetAmount - assignment);
  }
  if (row.target.kind === 'save_up_to') {
    return Math.max(0, targetAmount - balance);
  }
  // save_by_date
  if (!row.target.date) return 0;
  const targetYm = row.target.date.slice(0, 7);
  const monthsRemaining = Math.max(1, monthsInclusive(currentYm, targetYm));
  const shortfall = Math.max(0, targetAmount - balance);
  return shortfall / monthsRemaining;
}

// Distributes an available pool across envelopes in the order they appear,
// funding each up to its `suggestedAssignmentDelta` or whatever's left in the
// pool, whichever is smaller. Returns absolute new assignment amounts (in
// "X.YY" strings) ready to send as separate PUTs — the caller does the
// mutation fan-out and cache invalidation.
export function distributePoolAcrossEnvelopes(
  rows: readonly EnvelopeReportRow[],
  poolAvailable: string,
  currentYm: string,
): { categoryId: number; amount: string }[] {
  let remaining = Number(poolAvailable);
  if (!(remaining > 0)) return [];
  const out: { categoryId: number; amount: string }[] = [];
  for (const row of rows) {
    if (remaining <= 0.005) break;
    const delta = suggestedAssignmentDelta(row, currentYm);
    if (delta <= 0.005) continue;
    const grant = Math.min(delta, remaining);
    const newAsg = Number(row.assignment) + grant;
    out.push({ categoryId: row.categoryId, amount: newAsg.toFixed(2) });
    remaining -= grant;
  }
  return out;
}

// `t` is passed in from the calling component's `useTranslation('budgets')`
// since this function lives outside component/hook scope (same pattern as
// Dashboard/insights.ts's buildInsights).
export function computeTargetProgress(
  row: Pick<EnvelopeReportRow, 'target' | 'balance' | 'assignment'>,
  t: TFunction,
): { pct: number; label: string } | null {
  if (!row.target) return null;
  const amount = Number(row.target.amount);
  if (amount <= 0) return null;
  const bal = Number(row.balance);
  const asg = Number(row.assignment);
  let pct = 0;
  let label = '';
  if (row.target.kind === 'monthly_recurring') {
    pct = asg / amount;
    label = t('envelopes.targetProgress.monthly', { amount: formatAmount(row.target.amount) });
  } else if (row.target.kind === 'save_by_date') {
    pct = bal / amount;
    label = t('envelopes.targetProgress.saveByDate', {
      amount: formatAmount(row.target.amount),
      date: row.target.date ?? '—',
    });
  } else {
    pct = bal / amount;
    label = t('envelopes.targetProgress.saveUpTo', { amount: formatAmount(row.target.amount) });
  }
  return { pct: Math.max(0, Math.min(1, pct)), label };
}
