import type { TFunction } from 'i18next';
import type { EnvelopeReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';

export function formatSignedMoney(m: string): string {
  const n = Number(m);
  if (n < 0) return '−' + formatAmount(String(-n));
  return formatAmount(m);
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
