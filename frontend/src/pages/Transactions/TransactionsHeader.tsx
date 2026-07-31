import { useTranslation } from 'react-i18next';
import { TourReplayIcon } from '../../components/TourReplayIcon';
import { buildExportUrl } from './lib';
import type { Filters } from './filters';

// Page title + subtitle count and the header actions (mobile filters
// toggle, CSV export of the current filter, new-transaction button).
export function TransactionsHeader({
  total,
  filters,
  showFilters,
  onToggleFilters,
  onNewTransaction,
}: {
  total: number;
  filters: Filters;
  showFilters: boolean;
  onToggleFilters: () => void;
  onNewTransaction: () => void;
}) {
  const { t, i18n } = useTranslation('transactions');
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'fr-FR';
  return (
    <div className="page-header">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="page-title">{t('title')}</h1>
          <TourReplayIcon pageId="transactions" />
        </div>
        <p className="page-subtitle">
          {t('subtitle', { count: total, formatted: total.toLocaleString(locale) })}
        </p>
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary md:hidden" onClick={onToggleFilters}>
          {showFilters ? t('filtersToggle.hide') : t('filtersToggle.show')}
        </button>
        {import.meta.env.VITE_DEMO !== '1' && (
          <a className="btn-secondary" href={buildExportUrl(filters)} download>
            {t('actions.exportCsv')}
          </a>
        )}
        <button className="btn-primary" onClick={onNewTransaction}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {t('actions.newTransaction')}
        </button>
      </div>
    </div>
  );
}
