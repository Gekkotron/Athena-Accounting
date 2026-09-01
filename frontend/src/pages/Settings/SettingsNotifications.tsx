import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { Account } from '../../api/types';
import { useNotificationPrefs } from '../../lib/notifications/hooks';
import { NotificationsChannelsCard } from './NotificationsChannelsCard';
import { NotificationsPrivacyCard } from './NotificationsPrivacyCard';
import { NotificationsTriggersCard } from './NotificationsTriggersCard';
import { NotificationsTestButton } from './NotificationsTestButton';

export function SettingsNotifications(): JSX.Element {
  const { t } = useTranslation('settings');
  const { prefs, patch, mutation } = useNotificationPrefs();

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const accounts = accountsQ.data?.accounts ?? [];

  return (
    <section className="flex flex-col gap-4 pt-4 border-t border-ink-800/60">
      <div>
        <div className="label">{t('settings.notifications.sectionLabel')}</div>
        <p className="text-sm text-ink-400 mt-1">{t('settings.notifications.description')}</p>
      </div>

      {mutation.isError && (
        <p role="alert" className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200">
          {t('settings.notifications.patch_error')}
        </p>
      )}

      <label className="flex items-center gap-2 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        {t('settings.notifications.masterToggle')}
      </label>

      <fieldset
        disabled={!prefs.enabled}
        className={`border-0 p-0 m-0 min-w-0 flex flex-col gap-4 ${prefs.enabled ? '' : 'opacity-40'}`}
      >
        <NotificationsChannelsCard prefs={prefs} onPatch={patch} />
        <NotificationsPrivacyCard prefs={prefs.privacy} onPatch={patch} />
        <NotificationsTriggersCard prefs={prefs} accounts={accounts} onPatch={patch} />
      </fieldset>

      <NotificationsTestButton />
    </section>
  );
}
