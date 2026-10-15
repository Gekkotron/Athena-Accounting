import { useTranslation } from 'react-i18next';
import type { Settings } from '../../lib/settings';

const LABEL_CLASS = 'flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer select-none';

// Checkboxes in the Évolution section header. Both persist as user settings;
// the unrealized-gains one only makes sense once an investment account exists.
export function EvolutionHeaderToggles({ showForecast, showUnrealizedGains, hasAnyInvestment, onPatch }: {
  showForecast: boolean;
  showUnrealizedGains: boolean;
  hasAnyInvestment: boolean;
  onPatch: (p: Partial<Settings>) => void;
}): JSX.Element {
  const { t } = useTranslation('dashboard');
  return (
    <>
      {hasAnyInvestment && (
        <label className={LABEL_CLASS} title={t('unrealizedGains.tooltip')}>
          <input type="checkbox" checked={showUnrealizedGains} onChange={(e) => onPatch({ showUnrealizedGains: e.target.checked })} className="accent-sage-500" />
          {t('unrealizedGains.label')}
        </label>
      )}
      <label className={LABEL_CLASS} title={t('forecast.tooltip')}>
        <input type="checkbox" checked={showForecast} onChange={(e) => onPatch({ showForecast: e.target.checked })} className="accent-sage-500" />
        {t('forecast.label')}
      </label>
    </>
  );
}
