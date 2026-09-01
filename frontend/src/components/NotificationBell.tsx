import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useFloating, autoUpdate, offset, flip, shift,
  useClick, useDismiss, useRole, useInteractions, FloatingPortal,
} from '@floating-ui/react';
import type { Notification, NotificationKind } from '../../../shared/api-contracts.js';
import { useUnreadCount, useNotificationInbox, useMarkRead } from '../lib/notifications/hooks';

// Deep-link target per notification kind. There is no per-transaction detail
// page in this scope, so the transaction-shaped kinds all land on the list.
// bank_sync_failed would ideally go to a settings sub-page, but no
// /settings/bank-sync route exists yet (the live bank-sync page is
// /data/bank-sync) — falls back to the inbox until that route lands.
function routeForKind(kind: NotificationKind): string {
  switch (kind) {
    case 'big_transaction':
    case 'account_low':
    case 'envelope_exceeded':
      return '/transactions';
    case 'bank_sync_failed':
    case 'test':
    default:
      return '/notifications';
  }
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M9 2a4 4 0 00-4 4v2.2c0 .6-.2 1.2-.6 1.7L3 12h12l-1.4-2.1a2.8 2.8 0 01-.6-1.7V6a4 4 0 00-4-4z"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
      />
      <path d="M7 14.5a2 2 0 004 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function NotificationBellRow({
  notification, markAsReadLabel, onSelect,
}: {
  notification: Notification;
  markAsReadLabel: string;
  onSelect: (n: Notification) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(notification)}
      aria-label={`${notification.title} — ${markAsReadLabel}`}
      className="w-full text-left px-4 py-2.5 border-b border-ink-800/60 last:border-b-0 hover:bg-ink-850 transition"
    >
      <div className="text-sm text-ink-100 font-medium truncate">{notification.title}</div>
      <div className="text-xs text-ink-400 truncate">{notification.body}</div>
    </button>
  );
}

export function NotificationBell(): JSX.Element {
  const { t } = useTranslation('layout');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const unread = useUnreadCount();
  const inbox = useNotificationInbox({ unread: true });
  const markRead = useMarkRead();

  const count = unread.data?.count ?? 0;
  const displayCount = count > 99 ? '99+' : String(count);
  const items = (inbox.data?.items ?? []).slice(0, 10);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  const handleSelect = (n: Notification) => {
    markRead.mutate(n.id);
    setOpen(false);
    navigate(routeForKind(n.kind));
  };

  return (
    <div className="relative">
      <button
        ref={refs.setReference}
        type="button"
        aria-label={t('header.notifications.bell')}
        className="btn-ghost !min-h-0 !py-1.5 !px-2 relative"
        {...getReferenceProps()}
      >
        <BellIcon />
        {count > 0 && (
          <span
            data-testid="notification-badge"
            aria-hidden
            className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-clay-500/90 text-ink-950 text-[9px] font-mono leading-none font-semibold"
          >
            {displayCount}
          </span>
        )}
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-80 max-w-[90vw] rounded-lg border border-ink-700 bg-ink-900 shadow-lg ring-1 ring-ink-950/50 overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-ink-800 flex items-center justify-between">
              <span className="text-sm font-medium text-ink-100">{t('header.notifications.bell')}</span>
              {count > 0 && (
                <span className="text-xs text-ink-500">
                  {t('header.notifications.unread_count', { count })}
                </span>
              )}
            </div>
            <div className="flex flex-col max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-ink-500">
                  {t('header.notifications.empty')}
                </div>
              ) : (
                items.map((n) => (
                  <NotificationBellRow
                    key={n.id}
                    notification={n}
                    markAsReadLabel={t('header.notifications.mark_as_read')}
                    onSelect={handleSelect}
                  />
                ))
              )}
            </div>
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-center text-sm text-sage-300 hover:text-sage-200 border-t border-ink-800"
            >
              {t('header.notifications.see_all')}
            </Link>
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
