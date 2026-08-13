import { useTranslation } from 'react-i18next';
import type { SavingsGoalEvent } from '../../api/types';
import { amountSignClass, formatAmount, formatDate } from '../../lib/format';

export function EventRow({
  event,
  currency,
  onDelete,
}: {
  event: SavingsGoalEvent;
  currency: string;
  onDelete: (id: number) => void;
}) {
  const { t } = useTranslation('goals');
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-ink-800/60 last:border-b-0">
      <div className="min-w-0">
        <div className="text-xs text-ink-500 tabular-nums">{formatDate(event.eventDate)}</div>
        {event.note && (
          <div className="text-xs text-ink-400 truncate">{event.note}</div>
        )}
      </div>
      <div className={`text-sm tabular-nums font-mono ${amountSignClass(event.amount)}`}>
        <span className="private">{formatAmount(event.amount, currency)}</span>
      </div>
      <button
        type="button"
        onClick={() => onDelete(event.id)}
        aria-label={t('events.deleteAria')}
        className="p-1 text-ink-600 hover:text-clay-300 transition"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
