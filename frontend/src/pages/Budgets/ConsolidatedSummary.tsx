import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { BudgetConsolidatedBlock } from '../../api/types';
import { formatAmount } from '../../lib/format';

interface Props {
  consolidated: BudgetConsolidatedBlock;
}

// Surfaces the budget report's FX-converted `consolidated` block: a small
// note naming the display currency, the totals in that currency, and — when
// some currencies had no applicable rate — a warning strip mirroring the
// Dashboard's ConsolidatedTotalCard pattern.
export function ConsolidatedSummary({ consolidated }: Props): JSX.Element {
  const { t } = useTranslation('budgets');
  const { t: tCommon } = useTranslation('common');

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
      {consolidated.unmapped.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <div className="text-xs text-amber-300/90">{tCommon('fx.unmappedWarning')}</div>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {consolidated.unmapped.map((c) => (
              <li key={c.currency} className="flex items-center gap-1.5 text-sm">
                <span className="font-mono">{c.currency}</span>
                <Link to="/settings#fx" className="text-sky-300 hover:text-sky-200 underline underline-offset-2">
                  {tCommon('fx.addRate')}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
