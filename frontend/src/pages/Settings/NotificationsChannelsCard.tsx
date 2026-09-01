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
    </div>
  );
}
