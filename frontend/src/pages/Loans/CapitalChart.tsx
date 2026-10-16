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
      <h3 className="label mb-2">{t('chart.title')}</h3>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('chart.aria', { from: formatMonth(first.date), to: formatMonth(last.date) })}
        className="w-full h-36"
      >
        <path d={g.area} className="fill-sage-500/20" />
        <path d={g.line} className="fill-none stroke-sage-400" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {g.boundaries.map((bx) => (
          <line key={bx} x1={bx} x2={bx} y1={0} y2={H} className="stroke-ink-600"
            strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        ))}
        {g.todayX !== null && (
          <line x1={g.todayX} x2={g.todayX} y1={0} y2={H} className="stroke-amber-300" vectorEffect="non-scaling-stroke">
            <title>{t('chart.today')}</title>
          </line>
        )}
        {g.early.map((p) => (
          <circle key={`${p.x}-${p.y}`} cx={p.x} cy={p.y} r={3} className="fill-clay-300" />
        ))}
      </svg>
    </section>
  );
}
