import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { formatAmount, amountSignClass } from '../../lib/format';

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
// however many of those `consolidated.unmapped` couldn't be converted.
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
      <Link
        to="/settings#fx"
        className="mt-2 inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-300 underline underline-offset-2"
      >
        {t('fx.convertedFrom', { count: mappedCount })}
      </Link>
      {consolidated.unmapped.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <div className="text-xs text-amber-300/90">{t('fx.unmappedWarning')}</div>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {consolidated.unmapped.map((c) => (
              <li key={c.currency} className="flex items-center gap-1.5 text-sm">
                <span className="font-mono">{c.currency}</span>
                <Link to="/settings#fx" className="text-sky-300 hover:text-sky-200 underline underline-offset-2">
                  {t('fx.addRate')}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
