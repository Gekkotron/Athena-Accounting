import { useTranslation } from 'react-i18next';
import type { LoanScheduleRow } from '../../api/loans';
import { formatMonth } from '../../lib/format';
import { chartGeometry } from './chart-geometry';

const W = 600;
const H = 140;

interface Props {
  schedule: LoanScheduleRow[];
  principal: string;
  asOf: string;
}

export function CapitalChart({ schedule, principal, asOf }: Props) {
  const { t } = useTranslation('loans');
  const first = schedule[0];
  const last = schedule[schedule.length - 1];
  if (!first || !last) return null;
  const g = chartGeometry(schedule, principal, asOf, W, H);
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
        <h3 className="label">{t('chart.title')}</h3>
        <ul className="flex gap-3 text-[11px] text-ink-400">
          <li className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-sage-500" />{t('chart.legend.capital')}</li>
          <li className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-clay-400" />{t('chart.legend.interest')}</li>
          <li className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400" />{t('chart.legend.insurance')}</li>
        </ul>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('chart.aria', { from: formatMonth(first.date), to: formatMonth(last.date) })}
        className="w-full h-36"
      >
        <path d={g.capitalArea} className="fill-sage-500/70" />
        <path d={g.interestArea} className="fill-clay-400/75" />
        <path d={g.insuranceArea} className="fill-amber-400/80" />
        <path d={g.totalLine} className="fill-none stroke-ink-100/20" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {g.boundaries.map((bx) => (
          <line key={bx} x1={bx} x2={bx} y1={0} y2={H} className="stroke-ink-100/25"
            strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        ))}
        {g.todayX !== null && (
          <line x1={g.todayX} x2={g.todayX} y1={0} y2={H} className="stroke-amber-300" vectorEffect="non-scaling-stroke">
            <title>{t('chart.today')}</title>
          </line>
        )}
        {g.early.map((p) => (
          <circle key={`${p.x}-${p.y}`} cx={p.x} cy={p.y} r={3} className="fill-ink-100 stroke-ink-900" strokeWidth={1} />
        ))}
      </svg>
    </section>
  );
}
