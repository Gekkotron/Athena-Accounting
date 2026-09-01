import { useTranslation } from 'react-i18next';
import type { NotificationPrivacy, NotificationPrefsPatch } from '../../lib/settings';

export function NotificationsPrivacyCard({
  prefs,
  onPatch,
}: {
  prefs: NotificationPrivacy;
  onPatch: (p: NotificationPrefsPatch) => void;
}): JSX.Element {
  const { t } = useTranslation('settings');

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={prefs.hideAmount}
          onChange={(e) => onPatch({ privacy: { hideAmount: e.target.checked } })}
        />
        {t('settings.notifications.privacy.hideAmount')}
      </label>

      <label className="flex items-center gap-2 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={prefs.hideMerchant}
          onChange={(e) => onPatch({ privacy: { hideMerchant: e.target.checked } })}
        />
        {t('settings.notifications.privacy.hideMerchant')}
      </label>
    </div>
  );
}
