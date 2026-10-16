import { useTranslation } from 'react-i18next';
import type { LoanSummary } from '../../../api/loans';
import { formatAmount, formatMonth } from '../../../lib/format';
import { compareSummaries } from './compare';

interface Props {
  base: LoanSummary;
  next: LoanSummary;
  currency: string;
  baseLabel: string;
  nextLabel: string;
}

export function ComparisonTable({ base, next, currency, baseLabel, nextLabel }: Props) {
  const { t } = useTranslation('loans');
  const c = compareSummaries(base, next);
  const fmt = (v: string) => formatAmount(v, currency);
  const cost = Number(c.costDelta);
  const costNote = cost < 0
    ? t('whatIf.saves', { amount: fmt(String(-cost)) })
    : cost > 0 ? t('whatIf.costsMore', { amount: fmt(c.costDelta) }) : null;
  const endNote = c.endMonthsDelta < 0
    ? t('whatIf.earlier', { count: -c.endMonthsDelta })
    : c.endMonthsDelta > 0 ? t('whatIf.later', { count: c.endMonthsDelta }) : t('whatIf.sameEnd');
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-ink-500">
          <th />
          <th scope="col" className="text-right font-normal px-2">{baseLabel}</th>
          <th scope="col" className="text-right font-normal px-2">{nextLabel}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row" className="text-left font-normal text-ink-500 py-1">{t('whatIf.endDate')}</th>
          <td className="text-right px-2">{formatMonth(base.endDate)}</td>
          <td className="text-right px-2">
            {formatMonth(next.endDate)} <span className="text-ink-500">({endNote})</span>
          </td>
        </tr>
        <tr>
          <th scope="row" className="text-left font-normal text-ink-500 py-1">{t('whatIf.monthly')}</th>
          <td className="text-right px-2 font-mono private">{fmt(base.currentPaymentWithInsurance)}</td>
          <td className="text-right px-2 font-mono private">{fmt(next.currentPaymentWithInsurance)}</td>
        </tr>
        <tr>
          <th scope="row" className="text-left font-normal text-ink-500 py-1">{t('whatIf.cost')}</th>
          <td className="text-right px-2 font-mono private">{fmt(base.totals.cost)}</td>
          <td className="text-right px-2">
            <span className="font-mono private">{fmt(next.totals.cost)}</span>
            {costNote && (
              <span className={`ml-2 private ${cost < 0 ? 'text-sage-300' : 'text-clay-300'}`}>{costNote}</span>
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
