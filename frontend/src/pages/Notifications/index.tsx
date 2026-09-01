import { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { NotificationKind } from '../../../../shared/api-contracts.js';
import { useNotificationInbox, useMarkAllRead, useMarkRead, useDeleteNotification } from '../../lib/notifications/hooks';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { NotificationsList } from './NotificationsList';

// Filter chips map 1:1 to a query-param shape for useNotificationInbox.
// 'all' and 'unread' don't narrow by kind; the rest narrow by kind only
// (an unread + kind combination isn't exposed in the UI, matching the
// brief's flat chip row).
type FilterKey = 'all' | 'unread' | NotificationKind;

const FILTER_KEYS: FilterKey[] = [
  'all', 'unread', 'big_transaction', 'account_low', 'envelope_exceeded', 'bank_sync_failed',
];

function paramsForFilter(filter: FilterKey): { unread?: boolean; kind?: string } {
  if (filter === 'all') return {};
  if (filter === 'unread') return { unread: true };
  return { kind: filter };
}

export function Notifications(): JSX.Element {
  const { t } = useTranslation('notifications');
  const [filter, setFilter] = useState<FilterKey>('all');

  const inbox = useNotificationInbox(paramsForFilter(filter));
  const markAllRead = useMarkAllRead();
  const markRead = useMarkRead();
  const deleteNotification = useDeleteNotification();

  const items = inbox.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="display text-2xl text-ink-100">{t('title')}</h1>
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending}
        >
          {t('mark_all_read')}
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTER_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filter === key
                ? 'border-sage-300/60 bg-sage-900/30 text-sage-200'
                : 'border-ink-800 bg-ink-900/60 text-ink-400 hover:border-ink-700 hover:text-ink-200'
            }`}
          >
            {t(`filter.${key}`)}
          </button>
        ))}
      </div>

      {inbox.isLoading ? (
        <LoadingBlock />
      ) : inbox.isError ? (
        <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('empty.title')}
          hint={(
            <Trans i18nKey="notifications:empty.body">
              You&apos;re all caught up. Manage which alerts you get in <Link to="/settings/notifications" className="text-sage-300 hover:text-sage-200">Settings</Link>.
            </Trans>
          )}
        />
      ) : (
        <NotificationsList
          items={items}
          onMarkRead={(id) => markRead.mutate(id)}
          onDelete={(id) => deleteNotification.mutate(id)}
        />
      )}
    </div>
  );
}
