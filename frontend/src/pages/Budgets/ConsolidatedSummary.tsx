import { useTranslation } from 'react-i18next';
import type { BudgetConsolidatedBlock } from '../../api/types';
import { formatAmount } from '../../lib/format';
import { FxUnmappedWarning } from '../../components/FxUnmappedWarning';

interface Props {
  consolidated: BudgetConsolidatedBlock;
}

// Surfaces the budget report's FX-converted `consolidated` block: a small
// note naming the display currency, the totals in that currency, and — when
// some currencies had no applicable rate — a warning strip mirroring the
// Dashboard's ConsolidatedTotalCard pattern.
export function ConsolidatedSummary({ consolidated }: Props): JSX.Element {
  const { t } = useTranslation('budgets');

  return (
    <div className="surface p-4 border border-ink-800/60 flex flex-col gap-2">
      <p className="text-xs text-ink-500">
        {t('consolidated.note', { currency: consolidated.display })}
      </p>
      <p className="text-base text-ink-200 tabular-nums private">
        {t('consolidated.summary', {
          spent: formatAmount(consolidated.totals.spent, consolidated.display),
          limit: formatAmount(consolidated.totals.limit, consolidated.display),
          remaining: formatAmount(consolidated.totals.remaining, consolidated.display),
        })}
      </p>
      <FxUnmappedWarning unmapped={consolidated.unmapped} />
    </div>
  );
}
