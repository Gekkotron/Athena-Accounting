import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { useTestNotification } from '../../lib/notifications/hooks';

// Deliberately outside the master-toggle fieldset in SettingsNotifications:
// clicking it while notifications are disabled is how a user reaches the
// 422 "notifications_disabled" response and its inline hint below.
export function NotificationsTestButton(): JSX.Element {
  const { t } = useTranslation('settings');
  const testMut = useTestNotification();
  const disabledError = testMut.isError
    && testMut.error instanceof ApiError
    && testMut.error.status === 422;

  return (
    <div className="flex flex-col gap-2 pt-2">
      <button
        type="button"
        className="btn-secondary w-fit"
        onClick={() => testMut.mutate()}
        disabled={testMut.isPending}
      >
        {t('settings.notifications.test.button')}
      </button>
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
