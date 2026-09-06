import { useTranslation } from 'react-i18next';
import type { Notification } from '../../../../shared/api-contracts.js';
import { NotificationRow } from './NotificationRow';
import { toLocalIso } from '../../lib/dates';

// Groups notifications by LOCAL calendar day. createdAt is a UTC timestamp
// ("…Z"); slicing its 10 leading chars keys by the UTC date instead, which
// misgroups items created near midnight local time (a 00:30 CEST notification
// keys under the previous UTC day, and the "Today"/"Yesterday" label would
// disagree with the viewer's own clock). Assumes items arrive newest-first
// from the API so same-day items stay contiguous.
function groupByDay(items: Notification[]): [string, Notification[]][] {
  const groups: [string, Notification[]][] = [];
  for (const item of items) {
    const key = toLocalIso(new Date(item.createdAt));
    const last = groups[groups.length - 1];
    if (last && last[0] === key) {
      last[1].push(item);
    } else {
      groups.push([key, [item]]);
    }
  }
  return groups;
}

function dayLabel(key: string, locale: string, t: (k: string) => string): string {
  const now = new Date();
  const todayKey = toLocalIso(now);
  const yesterdayKey = toLocalIso(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (key === todayKey) return t('today');
  if (key === yesterdayKey) return t('yesterday');
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function NotificationsList({
  items,
  onMarkRead,
  onDelete,
}: {
  items: Notification[];
  onMarkRead: (id: number) => void;
  onDelete: (id: number) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation('notifications');
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'fr-FR';
  const groups = groupByDay(items);

  return (
    <div className="flex flex-col gap-6">
      {groups.map(([key, groupItems]) => (
        <div key={key}>
          <div data-testid="notification-group-header" className="text-xs uppercase tracking-wider text-ink-500 mb-2">
            {dayLabel(key, locale, t)}
          </div>
          <div className="surface-soft divide-y divide-ink-800/60">
            {groupItems.map((n) => (
              <NotificationRow key={n.id} notification={n} onMarkRead={onMarkRead} onDelete={onDelete} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
