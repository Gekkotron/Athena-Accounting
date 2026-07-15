import type { BudgetReport } from '../../api/types';
import { formatAmount } from '../../lib/format';

type StatusVariant = 'over' | 'slipping' | 'onTrack';

function statusVariant(totals: BudgetReport['totals']): StatusVariant {
  if (Number(totals.remaining) < 0) return 'over';
  if (totals.projected != null && Number(totals.projected) > Number(totals.limit)) return 'slipping';
  return 'onTrack';
}

function statusLine(
  variant: StatusVariant,
  totals: BudgetReport['totals'],
  period: BudgetReport['period'],
): { text: JSX.Element; className: string } {
  const endOfPeriod = period === 'monthly' ? "d'ici la fin du mois" : "d'ici la fin de l'année";
  if (variant === 'over') {
    const amount = formatAmount((-Number(totals.remaining)).toFixed(2));
    return {
      text: <>Vous avez dépassé de <span className="private tabular-nums">{amount}</span>.</>,
      className: 'text-clay-300',
    };
  }
  if (variant === 'slipping' && totals.projected != null) {
    const over = (Number(totals.projected) - Number(totals.limit)).toFixed(2);
    return {
      text: <>À ce rythme, vous dépasserez de <span className="private tabular-nums">{formatAmount(over)}</span>.</>,
      className: 'text-amber-300',
    };
  }
  return {
    text: <>Il reste <span className="private tabular-nums">{formatAmount(totals.remaining)}</span> {endOfPeriod}.</>,
    className: 'text-sage-300',
  };
}

export function SummaryCard(props: {
  totals: BudgetReport['totals'];
  rows: BudgetReport['rows'];
  period: BudgetReport['period'];
  monthOrYear: string;
}): JSX.Element {
  const { totals, period } = props;
  const when = period === 'monthly' ? 'ce mois-ci' : 'cette année';
  const status = statusLine(statusVariant(totals), totals, period);

  return (
    <div className="surface p-4 border border-ink-800/60 flex flex-col gap-2">
      <p className="text-lg text-ink-200">
        Vous avez dépensé{' '}
        <span className="text-ink-50 font-semibold tabular-nums private">
          {formatAmount(totals.spent)}
        </span>{' '}
        sur{' '}
        <span className="tabular-nums private">{formatAmount(totals.limit)}</span>{' '}
        {when}.
      </p>
      <p className={`text-sm ${status.className}`}>{status.text}</p>
    </div>
  );
}
