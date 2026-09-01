import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import {
  useNotificationPrefs,
  useTestNotification,
  type TestNotificationKind,
} from '../../lib/notifications/hooks';
import { requestWebPushPermission } from '../../lib/notifications/channels/webPush';

function currentPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

const ALERT_KINDS: readonly TestNotificationKind[] = [
  'big_transaction',
  'account_low',
  'envelope_exceeded',
  'bank_sync_failed',
];

// Picks the sample kind the "Send a test" click should preview, based on which
// sub-tab the user is looking at. Channels stays generic (the tab is about
// delivery, not payload); Privacy previews a big_transaction because that's
// where amount/merchant masking is most visible; Alerts randomizes across the
// four real triggers so repeated clicks show each variant.
function pickTestKind(tab: SettingsNotificationsTab): TestNotificationKind | undefined {
  switch (tab) {
    case 'channels': return undefined;
    case 'privacy':  return 'big_transaction';
    case 'triggers': return ALERT_KINDS[Math.floor(Math.random() * ALERT_KINDS.length)]!;
  }
}

export type SettingsNotificationsTab = 'channels' | 'privacy' | 'triggers';

// Deliberately outside the master-toggle fieldset in SettingsNotifications:
// clicking it while notifications are disabled is how a user reaches the
// 422 "notifications_disabled" response and its inline hint below.
export function NotificationsTestButton({ tab }: { tab: SettingsNotificationsTab }): JSX.Element {
  const { t } = useTranslation('settings');
  const { prefs } = useNotificationPrefs();
  const testMut = useTestNotification();
  const disabledError = testMut.isError
    && testMut.error instanceof ApiError
    && testMut.error.status === 422;

  const permission = currentPermission();
  const webPushOn = prefs.channels.webPush;
  // Hint the user when the click will produce a toast + inbox row but no OS
  // notification, so "Send a test" isn't misread as broken.
  const browserSilent = !webPushOn
    ? 'off'
    : permission === 'denied'
      ? 'blocked'
      : null;

  const onClick = async () => {
    // If the channel is on but the OS/browser permission is still `default`
    // (dismissed prompt or revoked to default from chrome://settings),
    // re-prompt in place so the SSE fan-out that follows can actually fire.
    if (webPushOn && permission === 'default') {
      await requestWebPushPermission();
    }
    testMut.mutate(pickTestKind(tab));
  };

  return (
    <div className="flex flex-col gap-2 pt-2">
      <button
        type="button"
        className="btn-secondary w-fit"
        onClick={() => void onClick()}
        disabled={testMut.isPending}
      >
        {t('settings.notifications.test.button')}
      </button>
      {browserSilent === 'off' && (
        <p className="text-sm text-ink-400">{t('settings.notifications.test.hintWebPushOff')}</p>
      )}
      {browserSilent === 'blocked' && (
        <p className="text-sm text-ink-400">{t('settings.notifications.test.hintWebPushBlocked')}</p>
      )}
      {testMut.isSuccess && (
        <p className="text-sm text-sage-300">{t('settings.notifications.test.success')}</p>
      )}
      {testMut.isError && (
        <p className="text-sm text-clay-300">
          {disabledError
            ? t('settings.notifications.test.disabledError')
            : t('settings.notifications.test.genericError')}
        </p>
      )}
    </div>
  );
}
