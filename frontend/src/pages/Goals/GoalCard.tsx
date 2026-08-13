import { useTranslation } from 'react-i18next';
import type { SavingsGoal } from '../../api/types';
import { formatAmount, formatDate } from '../../lib/format';
import { colorBand } from './goal-math';

const BAND_BAR: Record<'green' | 'amber' | 'red', string> = {
  green: 'bg-sage-500',
  amber: 'bg-amber-500',
  red: 'bg-clay-500',
};

// Compact goal card. Progress bar band is decided off `rawPct` so an
// overshoot reads red rather than settling at 100 %.
export function GoalCard({
  goal,
  onOpen,
  highlighted,
}: {
  goal: SavingsGoal;
  onOpen: (id: number) => void;
  highlighted?: boolean;
}) {
  const { t } = useTranslation('goals');
  const band = colorBand(goal.rawPct);
  const overshot = goal.rawPct > 100;
  const barPct = Math.min(100, Math.max(0, goal.progressPct));
  return (
    <button
      type="button"
      onClick={() => onOpen(goal.id)}
      className={`surface p-4 text-left w-full transition hover:border-ink-700 ${
        highlighted ? 'ring-2 ring-sage-500/70' : ''
      } ${goal.closedAt ? 'opacity-70' : ''}`}
      data-goal-id={goal.id}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-ink-100 truncate min-w-0">
          {goal.color && (
            <span
              aria-hidden
              className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
              style={{ background: goal.color }}
            />
          )}
          {goal.name}
        </div>
        <div className="text-[11px] text-ink-500 shrink-0 tabular-nums">
          {overshot
            ? t('card.overshoot', { pct: goal.rawPct.toFixed(0) })
            : `${goal.progressPct.toFixed(0)} %`}
        </div>
      </div>
      <div className="mt-3 h-1.5 w-full rounded-full bg-ink-900 overflow-hidden">
        <div
          className={`h-full ${BAND_BAR[band]} transition-all`}
          style={{ width: `${barPct}%` }}
        />
      </div>
      <div className="mt-2 text-[11px] text-ink-500 font-mono tabular-nums">
        <span className="private">
          {t('card.savedOfTarget', {
            saved: formatAmount(goal.savedAmount, goal.currency),
            target: formatAmount(goal.targetAmount, goal.currency),
          })}
        </span>
      </div>
      {goal.perMonthNeeded && !goal.closedAt && (
        <div className="mt-1 text-[11px] text-ink-400">
          <span className="private">
            {t('card.perMonthNeeded', {
              amount: formatAmount(goal.perMonthNeeded, goal.currency),
            })}
          </span>
        </div>
      )}
      {goal.overdueDays != null && (
        <div className="mt-1 text-[11px] text-amber-300/90">
          {t('card.overdueDays', { count: goal.overdueDays })}
        </div>
      )}
      {goal.targetDate && !goal.overdueDays && (
        <div className="mt-1 text-[11px] text-ink-500">{formatDate(goal.targetDate)}</div>
      )}
    </button>
  );
}
