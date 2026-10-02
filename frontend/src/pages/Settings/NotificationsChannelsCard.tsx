import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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

  const callmebot = prefs.channels.callmebot;
  const [cmbPhone, setCmbPhone] = useState(callmebot.phone);
  const [cmbApiKey, setCmbApiKey] = useState(callmebot.apiKey);
  const [cmbMinInterval, setCmbMinInterval] = useState(String(callmebot.minIntervalMinutes));
  const cmbIntervalParsed = Number.parseInt(cmbMinInterval, 10);
  const cmbIntervalValue = Number.isFinite(cmbIntervalParsed) && cmbIntervalParsed >= 0
    ? cmbIntervalParsed
    : 0;
  const cmbDirty =
    cmbPhone !== callmebot.phone
    || cmbApiKey !== callmebot.apiKey
    || cmbIntervalValue !== callmebot.minIntervalMinutes;
  const saveCallMeBot = () => {
    onPatch({
      channels: {
        callmebot: {
          phone: cmbPhone.trim(),
          apiKey: cmbApiKey.trim(),
          minIntervalMinutes: cmbIntervalValue,
        },
      },
    });
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

      <details className="text-xs text-ink-400 pl-6">
        <summary className="cursor-pointer text-ink-300 hover:text-ink-100">
          {t('settings.notifications.channels.browserNotificationsTip.title')}
        </summary>
        <div className="mt-2 flex flex-col gap-2 pl-2">
          <p>{t('settings.notifications.channels.browserNotificationsTip.intro')}</p>
          <ol className="list-decimal list-inside flex flex-col gap-1">
            <li>{t('settings.notifications.channels.browserNotificationsTip.step1')}</li>
            <li>{t('settings.notifications.channels.browserNotificationsTip.step2')}</li>
            <li>{t('settings.notifications.channels.browserNotificationsTip.step3')}</li>
          </ol>
          <p>
            {t('settings.notifications.channels.browserNotificationsTip.httpNote_pre')}{' '}
            <code className="rounded bg-ink-900/50 px-1 py-0.5 text-ink-100">
              {t('settings.notifications.channels.browserNotificationsTip.httpNote_flag')}
            </code>{' '}
            {t('settings.notifications.channels.browserNotificationsTip.httpNote_post')}
          </p>
        </div>
      </details>

      <div className="mt-2 flex flex-col gap-2 border-t border-ink-800/60 pt-3">
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input
            type="checkbox"
            checked={callmebot.enabled}
            onChange={(e) => onPatch({ channels: { callmebot: { enabled: e.target.checked } } })}
          />
          {t('settings.notifications.channels.callmebot.label')}
        </label>

        {callmebot.enabled && (
          <div className="flex flex-col gap-2 pl-6 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-ink-300">
                {t('settings.notifications.channels.callmebot.phoneLabel')}
              </span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder={t('settings.notifications.channels.callmebot.phonePlaceholder')}
                value={cmbPhone}
                onChange={(e) => setCmbPhone(e.target.value)}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ink-300">
                {t('settings.notifications.channels.callmebot.apiKeyLabel')}
              </span>
              <input
                type="password"
                autoComplete="off"
                placeholder={t('settings.notifications.channels.callmebot.apiKeyPlaceholder')}
                value={cmbApiKey}
                onChange={(e) => setCmbApiKey(e.target.value)}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ink-300">
                {t('settings.notifications.channels.callmebot.minIntervalLabel')}
              </span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={cmbMinInterval}
                onChange={(e) => setCmbMinInterval(e.target.value.replace(/[^0-9]/g, ''))}
                className="input"
                placeholder="0"
              />
              <span className="text-xs text-ink-400">
                {t('settings.notifications.channels.callmebot.minIntervalHelp')}
              </span>
            </label>
            <button
              type="button"
              className="btn-secondary w-fit"
              onClick={saveCallMeBot}
              disabled={!cmbDirty}
            >
              {t('settings.notifications.channels.callmebot.save')}
            </button>
            <p className="text-xs text-ink-400">
              <Trans i18nKey="settings.notifications.channels.callmebot.help" t={t}>
                Activate it once from your phone — see
                <a
                  className="underline hover:text-ink-100"
                  href="https://www.callmebot.com/blog/free-api-whatsapp-messages/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  CallMeBot WhatsApp setup
                </a>
                .
              </Trans>
            </p>
          </div>
        )}
      </div>

    </div>
  );
}
