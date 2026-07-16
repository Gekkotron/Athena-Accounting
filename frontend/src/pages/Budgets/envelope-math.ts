import type { EnvelopeReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';

export function formatSignedMoney(m: string): string {
  const n = Number(m);
  if (n < 0) return '−' + formatAmount(String(-n));
  return formatAmount(m);
}

export function computeTargetProgress(
  row: Pick<EnvelopeReportRow, 'target' | 'balance' | 'assignment'>,
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
    label = `Objectif: ${formatAmount(row.target.amount)}/mois`;
  } else if (row.target.kind === 'save_by_date') {
    pct = bal / amount;
    label = `Objectif: ${formatAmount(row.target.amount)} d'ici ${row.target.date ?? '—'}`;
  } else {
    pct = bal / amount;
    label = `Objectif: ${formatAmount(row.target.amount)}`;
  }
  return { pct: Math.max(0, Math.min(1, pct)), label };
}
