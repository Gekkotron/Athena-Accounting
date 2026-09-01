import { useTranslation } from 'react-i18next';
import type { Notification, NotificationKind } from '../../../../shared/api-contracts.js';

// Kinds with a dedicated filter chip (and thus a `filter.*` label) — 'test'
// notifications have no chip and render without a kind label.
const KIND_LABEL_KEY: Partial<Record<NotificationKind, string>> = {
  big_transaction: 'filter.big_transaction',
  account_low: 'filter.account_low',
  envelope_exceeded: 'filter.envelope_exceeded',
  bank_sync_failed: 'filter.bank_sync_failed',
};

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

function formatRelativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return rtf.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return rtf.format(diffSeconds, 'second');
}

export function NotificationRow({
  notification,
  onMarkRead,
  onDelete,
}: {
  notification: Notification;
  onMarkRead: (id: number) => void;
  onDelete: (id: number) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation('notifications');
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'fr-FR';
  const kindLabelKey = KIND_LABEL_KEY[notification.kind];
  const isUnread = !notification.readAt;

  return (
    <div
      data-testid="notification-row"
      className={`group relative flex items-start gap-3 px-4 py-3 ${isUnread ? 'bg-sage-300/5' : ''}`}
    >
      <span
        aria-hidden
        data-testid="notification-unread-dot"
        className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${isUnread ? 'bg-sage-300' : 'bg-transparent'}`}
      />
      <div className="min-w-0 flex-1">
        {kindLabelKey && (
          <div className="text-[10px] uppercase tracking-wider text-ink-500">{t(kindLabelKey)}</div>
        )}
        <div className="text-sm text-ink-100 font-medium truncate">{notification.title}</div>
        <div className="text-xs text-ink-400">{notification.body}</div>
        <div className="text-[11px] text-ink-500 mt-1">{formatRelativeTime(notification.createdAt, locale)}</div>
      </div>
      <div className="hidden group-hover:flex items-center gap-1 shrink-0">
        {isUnread && (
          <button
            type="button"
            className="btn-ghost !min-h-0 !py-1 !px-2 text-xs"
            onClick={() => onMarkRead(notification.id)}
          >
            {t('mark_read')}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost !min-h-0 !py-1 !px-2 text-xs text-clay-300"
          onClick={() => onDelete(notification.id)}
        >
          {t('delete')}
        </button>
      </div>
    </div>
  );
}
