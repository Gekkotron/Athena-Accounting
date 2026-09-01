import { useTranslation } from 'react-i18next';
import type { NotificationPrefs, NotificationPrefsPatch } from '../../lib/settings';
import { requestWebPushPermission } from '../../lib/notifications/channels/webPush';

function currentPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export function NotificationsChannelsCard({
  prefs,
  onPatch,
}: {
  prefs: NotificationPrefs;
  onPatch: (p: NotificationPrefsPatch) => void;
}): JSX.Element {
  const { t } = useTranslation('settings');
  const browserBlocked = currentPermission() === 'denied';

  const toggleWebPush = async (checked: boolean) => {
    if (!checked) {
      onPatch({ channels: { webPush: false } });
      return;
    }
    const result = await requestWebPushPermission();
    onPatch({ channels: { webPush: result === 'granted' } });
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={prefs.channels.toast}
          onChange={(e) => onPatch({ channels: { toast: e.target.checked } })}
        />
        {t('settings.notifications.channels.toast')}
      </label>

      <label className="flex items-center gap-2 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={prefs.channels.webPush}
          disabled={browserBlocked}
          onChange={(e) => void toggleWebPush(e.target.checked)}
        />
        {t('settings.notifications.channels.webPush')}
        {browserBlocked && (
          <span className="text-xs text-clay-300">
            {t('settings.notifications.channels.webPushBlocked')}
          </span>
        )}
      </label>

      <details className="mt-1 text-xs text-ink-400">
        <summary className="cursor-pointer text-ink-300 hover:text-ink-100">
          {t('settings.notifications.channels.chromeInsecureTip.title')}
        </summary>
        <div className="mt-2 flex flex-col gap-2 pl-2">
          <p>{t('settings.notifications.channels.chromeInsecureTip.intro')}</p>
          <ol className="list-decimal list-inside flex flex-col gap-1">
            <li>
              {t('settings.notifications.channels.chromeInsecureTip.step1_pre')}{' '}
              <code className="rounded bg-ink-900/50 px-1 py-0.5 text-ink-100">
                {t('settings.notifications.channels.chromeInsecureTip.step1_url')}
              </code>
            </li>
            <li>{t('settings.notifications.channels.chromeInsecureTip.step2')}</li>
            <li>
              {t('settings.notifications.channels.chromeInsecureTip.step3_pre')}{' '}
              <code className="rounded bg-ink-900/50 px-1 py-0.5 text-ink-100">
                {t('settings.notifications.channels.chromeInsecureTip.step3_example')}
              </code>
              {t('settings.notifications.channels.chromeInsecureTip.step3_post')}
            </li>
          </ol>
        </div>
      </details>
    </div>
  );
}
