import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { Account } from '../../api/types';
import { useNotificationPrefs } from '../../lib/notifications/hooks';
import { NotificationsChannelsCard } from './NotificationsChannelsCard';
import { NotificationsPrivacyCard } from './NotificationsPrivacyCard';
import { NotificationsTriggersCard } from './NotificationsTriggersCard';
import { NotificationsTestButton } from './NotificationsTestButton';

type TabId = 'channels' | 'privacy' | 'triggers';

export function SettingsNotifications(): JSX.Element {
  const { t } = useTranslation('settings');
  const { prefs, patch, mutation } = useNotificationPrefs();
  const [tab, setTab] = useState<TabId>('channels');

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const accounts = accountsQ.data?.accounts ?? [];

  const tabs: readonly { id: TabId; label: string }[] = [
    { id: 'channels', label: t('settings.notifications.channels.sectionLabel') },
    { id: 'privacy', label: t('settings.notifications.privacy.sectionLabel') },
    { id: 'triggers', label: t('settings.notifications.triggers.sectionLabel') },
  ];

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

      <div
        role="tablist"
        aria-label={t('settings.notifications.sectionLabel')}
        className="flex flex-wrap gap-1 border-b border-ink-800/70"
      >
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`notif-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`notif-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            className={`-mb-px px-3 py-2 text-sm border-b-2 transition ${
              tab === id
                ? 'text-ink-50 border-sage-300'
                : 'text-ink-400 border-transparent hover:text-ink-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <fieldset
        disabled={!prefs.enabled}
        className={`border-0 p-0 m-0 min-w-0 flex flex-col gap-3 ${prefs.enabled ? '' : 'opacity-40'}`}
      >
        {tab === 'channels' && (
          <div role="tabpanel" id="notif-panel-channels" aria-labelledby="notif-tab-channels">
            <NotificationsChannelsCard prefs={prefs} onPatch={patch} />
          </div>
        )}
        {tab === 'privacy' && (
          <div role="tabpanel" id="notif-panel-privacy" aria-labelledby="notif-tab-privacy">
            <NotificationsPrivacyCard prefs={prefs.privacy} onPatch={patch} />
          </div>
        )}
        {tab === 'triggers' && (
          <div role="tabpanel" id="notif-panel-triggers" aria-labelledby="notif-tab-triggers">
            <NotificationsTriggersCard prefs={prefs} accounts={accounts} onPatch={patch} />
          </div>
        )}
      </fieldset>

      <NotificationsTestButton />
    </section>
  );
}
