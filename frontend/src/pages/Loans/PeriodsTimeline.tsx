import { useTranslation } from 'react-i18next';
import type { LoanScheduleRow } from '../../api/loans';
import { formatAmount, formatMonth } from '../../lib/format';
import { timelineItems } from './timeline';

export function PeriodsTimeline({ schedule, currency }: { schedule: LoanScheduleRow[]; currency: string }) {
  const { t } = useTranslation('loans');
  const items = timelineItems(schedule);
  return (
    <section>
      <h3 className="label mb-2">{t('timeline.title')}</h3>
      <ol className="space-y-1">
        {items.map((it) => (
          <li key={`${it.periodIndex}-${it.from}`} className="surface-soft px-3 py-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <span className="text-ink-100 min-w-32">{t(`timeline.kinds.${it.kind}`)}</span>
            <span className="text-ink-500">
              {t('timeline.range', { from: formatMonth(it.from), to: formatMonth(it.to) })}
              {' · '}
              {t('timeline.months', { count: it.months })}
            </span>
            <span className="font-mono tabular-nums text-ink-100 private">{formatAmount(it.payment, currency)}</span>
            <span className="text-ink-500">{it.rate} %</span>
            {it.periodIndex === -1 && <span className="text-[10px] text-sage-300">{t('timeline.computed')}</span>}
            {it.varies && <span className="text-[10px] text-ink-500">{t('timeline.varies')}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
