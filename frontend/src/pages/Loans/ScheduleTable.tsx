import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LoanScheduleRow } from '../../api/loans';
import { formatAmount, formatDate } from '../../lib/format';
import { groupByYear } from './schedule-groups';

const COLS = ['date', 'payment', 'interest', 'capital', 'insurance', 'early', 'balance'] as const;

interface Props {
  schedule: LoanScheduleRow[];
  asOf: string;
  currency: string;
}

// Year-grouped amortisation table: the current year is expanded and the
// instalment of the current month is highlighted (aria-current="date").
export function ScheduleTable({ schedule, asOf, currency }: Props) {
  const { t } = useTranslation('loans');
  const groups = useMemo(() => groupByYear(schedule), [schedule]);
  const fmt = (v: string) => formatAmount(v, currency);
  const currentDate = schedule.find((r) => r.date.slice(0, 7) === asOf.slice(0, 7))?.date ?? null;
  return (
    <section>
      <h3 className="label mb-2">{t('schedule.title')}</h3>
      <div className="space-y-1">
        {groups.map((g) => (
          <details key={g.year} open={g.year === asOf.slice(0, 4)} className="surface-soft">
            <summary className="cursor-pointer px-3 py-2 flex justify-between text-xs">
              <span className="text-ink-100">{t('schedule.year', { year: g.year })}</span>
              <span className="font-mono tabular-nums text-ink-300 private">{fmt(g.totals.payment)}</span>
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="text-ink-500">
                    {COLS.map((c) => (
                      <th key={c} scope="col" className="px-2 py-1 text-right first:text-left font-normal">
                        {t(`schedule.cols.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => {
                    const current = r.date === currentDate;
                    return (
                      <tr key={r.index} aria-current={current ? 'date' : undefined} className={current ? 'bg-ink-800' : ''}>
                        <td className="px-2 py-1">{formatDate(r.date)}</td>
                        {[r.payment, r.interest, r.capital, r.insurance].map((v, i) => (
                          <td key={i} className="px-2 py-1 text-right font-mono private">{fmt(v)}</td>
                        ))}
                        <td className="px-2 py-1 text-right font-mono private">{r.earlyRepayment ? fmt(r.earlyRepayment) : '—'}</td>
                        <td className="px-2 py-1 text-right font-mono private">{fmt(r.balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
