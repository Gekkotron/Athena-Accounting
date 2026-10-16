import { useTranslation } from 'react-i18next';
import type { LoanSummary } from '../../api/loans';
import { formatAmount, formatMonth } from '../../lib/format';

interface Tile {
  label: string;
  value: string;
  sub?: string;
  isPrivate?: boolean;
}

const COST_PARTS = ['interest', 'insurance', 'fees', 'penalties'] as const;

export function SummaryStrip({ summary: s, currency }: { summary: LoanSummary; currency: string }) {
  const { t } = useTranslation('loans');
  const fmt = (v: string) => formatAmount(v, currency);
  const tiles: Tile[] = [
    { label: t('summary.owed'), value: fmt(s.today.capitalOwed), isPrivate: true },
    { label: t('summary.repaid'), value: `${Math.round(s.today.repaidPct)} %` },
    {
      label: t('summary.interestPaid'), value: fmt(s.today.interestPaid),
      sub: t('summary.interestOf', { total: fmt(s.totals.interest) }), isPrivate: true,
    },
    { label: t('summary.monthsLeft'), value: String(s.today.monthsLeft) },
    { label: t('summary.endDate'), value: formatMonth(s.endDate) },
    {
      label: t('summary.monthly'), value: fmt(s.currentPayment),
      sub: t('summary.withInsurance', { amount: fmt(s.currentPaymentWithInsurance) }), isPrivate: true,
    },
  ];
  return (
    <section className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="surface-soft p-3">
            <div className="text-[11px] text-ink-500">{tile.label}</div>
            <div className={`text-sm font-mono tabular-nums text-ink-100 ${tile.isPrivate ? 'private' : ''}`}>
              {tile.value}
            </div>
            {tile.sub && <div className="text-[11px] text-ink-500 private">{tile.sub}</div>}
          </div>
        ))}
      </div>
      <div className="surface-soft p-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-300">{t('summary.cost')}</span>
          <span className="font-mono tabular-nums text-ink-100 private">{fmt(s.totals.cost)}</span>
        </div>
        <dl className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
          {COST_PARTS.map((k) => (
            <div key={k}>
              <dt className="text-ink-500">{t(`summary.${k}`)}</dt>
              <dd className="font-mono tabular-nums private">{fmt(s.totals[k])}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
