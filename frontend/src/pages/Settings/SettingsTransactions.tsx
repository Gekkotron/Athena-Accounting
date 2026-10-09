import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionRule } from '../../components/SectionRule';
import { SelectField, type SelectOption } from '../Settings-fields';
import { useSettingsFlash } from './useSettingsFlash';
import { useAccounts, EMPTY_ACCOUNTS } from '../../lib/useReferenceData';
import { SettingsSkeleton, SaveErrorBanner } from './_shared';

export function SettingsTransactions(): JSX.Element {
  const { t } = useTranslation('settings');
  const { settings, isReady, flashKey, send, mutation } = useSettingsFlash();

  const accountsQ = useAccounts();
  const accounts = accountsQ.data ?? EMPTY_ACCOUNTS;

  const defaultAccountOptions = useMemo<SelectOption[]>(() => [
    { value: 'first-checking', label: t('settings.transactionsSection.firstCheckingOption') },
    { value: 'all', label: t('settings.transactionsSection.allAccountsOption') },
    ...accounts.map((a) => ({ value: String(a.id), label: `${a.name} (${a.currency})` })),
  ], [accounts, t]);

  if (!isReady) return <SettingsSkeleton />;

  const rawValue =
    settings.transactionsDefaultAccount === 'first-checking'
      ? 'first-checking'
      : settings.transactionsDefaultAccount === 'all'
        ? 'all'
        : String(settings.transactionsDefaultAccount);

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <p className="text-sm text-ink-400">{t('settings.transactionsSection.subtitle')}</p>

      {mutation.isError && <SaveErrorBanner message={t('settings.errors.saveFailed')} />}

      <div className="surface p-6 flex flex-col gap-4">
        <SectionRule>{t('settings.transactionsSection.label')}</SectionRule>

        <SelectField
          label={t('settings.transactionsSection.defaultAccountLabel')}
          value={rawValue}
          options={defaultAccountOptions}
          flashing={flashKey === 'transactionsDefaultAccount'}
          onChange={(v) => {
            if (v === 'first-checking' || v === 'all') {
              send('transactionsDefaultAccount', v);
            } else {
              send('transactionsDefaultAccount', Number(v));
            }
          }}
        />
      </div>
    </div>
  );
}
