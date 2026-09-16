import { useTranslation } from 'react-i18next';
import { LoadingBlock } from '../../components/StateBlocks';
import { SavedChip } from '../Settings-fields';
import { useSettingsFlash } from './useSettingsFlash';
import { useAccounts } from '../../lib/useReferenceData';

export function SettingsTransactions(): JSX.Element {
  const { t } = useTranslation('settings');
  const { settings, isReady, flashKey, send, mutation } = useSettingsFlash();

  const accountsQ = useAccounts();
  const accounts = accountsQ.data ?? [];

  if (!isReady) {
    return (
      <div className="max-w-xl">
        <div data-testid="settings-skeleton">
          <LoadingBlock height="min-h-64" />
        </div>
      </div>
    );
  }

  const rawValue =
    settings.transactionsDefaultAccount === 'first-checking'
      ? 'first-checking'
      : settings.transactionsDefaultAccount === 'all'
        ? 'all'
        : String(settings.transactionsDefaultAccount);

  return (
    <div className="max-w-xl flex flex-col gap-6">
      {mutation.isError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          {t('settings.errors.saveFailed')}
        </div>
      )}

      <div className="surface p-6 flex flex-col gap-4">
        <div className="label">{t('settings.transactionsSection.label')}</div>

        <div>
          <label className="text-sm mb-2 block">
            {t('settings.transactionsSection.defaultAccountLabel')}
            {flashKey === 'transactionsDefaultAccount' && <SavedChip />}
          </label>
          <select
            className="input"
            aria-label={t('settings.transactionsSection.defaultAccountLabel')}
            value={rawValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'first-checking' || v === 'all') {
                send('transactionsDefaultAccount', v);
              } else {
                send('transactionsDefaultAccount', Number(v));
              }
            }}
          >
            <option value="first-checking">{t('settings.transactionsSection.firstCheckingOption')}</option>
            <option value="all">{t('settings.transactionsSection.allAccountsOption')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
