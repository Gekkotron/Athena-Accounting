import { useTranslation } from 'react-i18next';
import type { FxRateWire } from './RatesTable';

interface SuggestionsStripProps {
  accountCurrencies: string[];
  rates: FxRateWire[];
  displayCurrency: string;
  onAdd: (from: string, to: string) => void;
}

// Lists every account currency that has no (currency -> displayCurrency)
// rate row yet, so the user can jump straight to adding it.
export function SuggestionsStrip({
  accountCurrencies,
  rates,
  displayCurrency,
  onAdd,
}: SuggestionsStripProps): JSX.Element | null {
  const { t } = useTranslation('settings');

  const missing = Array.from(new Set(accountCurrencies))
    .filter((c) => c !== displayCurrency)
    .filter((c) => !rates.some((r) => r.from === c && r.to === displayCurrency))
    .sort();

  if (missing.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {missing.map((c) => (
        <div
          key={c}
          className="flex items-center justify-between rounded-lg border border-amber-800/50 bg-amber-900/15 px-3 py-2 text-sm text-amber-200"
        >
          <span>{t('settings.fx.suggest.missingPair', { from: c, to: displayCurrency })}</span>
          <button type="button" className="btn-ghost" onClick={() => onAdd(c, displayCurrency)}>
            {t('settings.fx.rates.add')}
          </button>
        </div>
      ))}
    </div>
  );
}
