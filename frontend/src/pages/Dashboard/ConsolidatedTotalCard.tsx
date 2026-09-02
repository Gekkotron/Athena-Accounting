import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { formatAmount, amountSignClass } from '../../lib/format';
import { FxUnmappedWarning } from '../../components/FxUnmappedWarning';

export interface PerCurrencyRow {
  currency: string;
  total: string;
  available: string;
  invested: string;
  account_count: number;
}

export interface ConsolidatedBlock {
  display: string;
  total: string;
  available: string;
  invested: string;
  unmapped: PerCurrencyRow[];
}

interface Props {
  consolidated: ConsolidatedBlock | null;
  currencyCount: number;
}

// Collapses every currency the manual FX table can convert (Settings →
// Multi-devises) into one total. `currencyCount` is the full perCurrency
// row count from the balance report; the "converted from N" chip subtracts
// however many of those `consolidated.unmapped` couldn't be converted, and
// is suppressed entirely when at most one currency is in the pot — nothing
// was actually converted, so "Converted from 1 currency" would be false.
export function ConsolidatedTotalCard({ consolidated, currencyCount }: Props): JSX.Element | null {
  const { t } = useTranslation('common');
  if (!consolidated) return null;
  const mappedCount = Math.max(currencyCount - consolidated.unmapped.length, 0);
  return (
    <div className="surface p-5 md:p-6 min-w-[220px]">
      <div className="label">{consolidated.display}</div>
      <div className={`display text-4xl mt-1 tabular-nums ${amountSignClass(consolidated.total)}`}>
        {formatAmount(consolidated.total, consolidated.display)}
      </div>
      {mappedCount > 1 && (
        <Link
          to="/settings#fx"
          className="mt-2 inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-300 underline underline-offset-2"
        >
          {t('fx.convertedFrom', { count: mappedCount })}
        </Link>
      )}
      <FxUnmappedWarning unmapped={consolidated.unmapped} className="mt-3" />
    </div>
  );
}
