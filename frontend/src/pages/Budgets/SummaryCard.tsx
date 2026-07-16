import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
  t: TFunction,
): { text: JSX.Element; className: string } {
  const endOfPeriod = period === 'monthly' ? t('summary.endOfMonth') : t('summary.endOfYear');
  if (variant === 'over') {
    const amount = formatAmount((-Number(totals.remaining)).toFixed(2));
    return {
      text: (
        <Trans t={t} i18nKey="summary.over">
          You exceeded by <span className="private tabular-nums">{{ amount } as unknown as string}</span>.
        </Trans>
      ),
      className: 'text-clay-300',
    };
  }
  if (variant === 'slipping' && totals.projected != null) {
    const over = (Number(totals.projected) - Number(totals.limit)).toFixed(2);
    return {
      text: (
        <Trans t={t} i18nKey="summary.slipping">
          At this rate, you'll exceed by <span className="private tabular-nums">{{ amount: formatAmount(over) } as unknown as string}</span>.
        </Trans>
      ),
      className: 'text-amber-300',
    };
  }
  return {
    text: (
      <Trans t={t} i18nKey="summary.remaining">
        There's <span className="private tabular-nums">{{ amount: formatAmount(totals.remaining) } as unknown as string}</span> left {{ endOfPeriod } as unknown as string}.
      </Trans>
    ),
    className: 'text-sage-300',
  };
}

export function SummaryCard(props: {
  totals: BudgetReport['totals'];
  rows: BudgetReport['rows'];
  period: BudgetReport['period'];
  monthOrYear: string;
}): JSX.Element {
  const { t } = useTranslation('budgets');
  const { totals, period } = props;
  const when = period === 'monthly' ? t('summary.whenMonth') : t('summary.whenYear');
  const status = statusLine(statusVariant(totals), totals, period, t);

  return (
    <div className="surface p-4 border border-ink-800/60 flex flex-col gap-2">
      <p className="text-lg text-ink-200">
        <Trans t={t} i18nKey="summary.hero">
          You spent <span className="text-ink-50 font-semibold tabular-nums private">{{ spent: formatAmount(totals.spent) } as unknown as string}</span> of <span className="tabular-nums private">{{ limit: formatAmount(totals.limit) } as unknown as string}</span> {{ when } as unknown as string}.
        </Trans>
      </p>
      <p className={`text-sm ${status.className}`}>{status.text}</p>
    </div>
  );
}
