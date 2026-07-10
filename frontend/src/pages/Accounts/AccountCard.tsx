import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Account } from '../../api/types';
import { formatAmount, amountSignClass, formatDate } from '../../lib/format';
import { BalanceCheckpointsDrawer } from './BalanceCheckpointsDrawer';

export function AccountCard({
  account: a,
  onEdit,
  onExpand,
  expanded,
}: {
  account: Account;
  onEdit: (account: Account) => void;
  onExpand: (id: number) => void;
  expanded: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: a.id });
  const current = Number(a.currentBalance ?? '0');
  const available = Number(a.availableBalance ?? a.currentBalance ?? '0');
  const blocked = current - available;
  const hasBlocked = Math.abs(blocked) >= 0.005;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="surface p-5 relative group">
      {/* Reserve room on the right for the absolute-positioned drag handle
          + modifier cluster (top-3 right-3) so the currency badge doesn't
          drift underneath it. */}
      <div className="flex items-baseline justify-between gap-3 pr-24">
        <div className="text-sm font-medium text-ink-100 truncate">{a.name}</div>
        <span className="badge">{a.currency}</span>
      </div>
      <div className="label mt-0.5">{a.type}</div>
      <div className={`display mt-4 text-3xl tabular-nums ${amountSignClass(a.currentBalance ?? '0')}`}>
        {formatAmount(a.currentBalance ?? '0', a.currency)}
      </div>
      {hasBlocked && (
        <div className="text-[11px] text-amber-300/90 mt-1 font-mono">
          dont <span className="private">{formatAmount(blocked, a.currency)}</span> bloqués
          {a.lockYears != null && (
            <span className="text-ink-500"> · {a.lockYears} an{a.lockYears > 1 ? 's' : ''}</span>
          )}
        </div>
      )}
      {a.isInvestment && !hasBlocked && (
        <div className="text-[11px] text-sky-300/90 mt-1 font-mono">placé</div>
      )}
      <div className="text-[11px] text-ink-500 mt-3 font-mono leading-relaxed">
        ouvert {formatDate(a.openingDate)} ·{' '}
        <span className="private">{formatAmount(a.openingBalance, a.currency)}</span>
      </div>
      {/* Top-right cluster: drag handle + modify */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <button
          type="button"
          className="p-1 rounded text-ink-600 hover:text-ink-100 hover:bg-ink-900 transition cursor-grab active:cursor-grabbing touch-none"
          title="Réorganiser (glisser-déposer)"
          aria-label="Réorganiser ce compte"
          {...attributes}
          {...listeners}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="4" cy="3" r="1" fill="currentColor" />
            <circle cx="8" cy="3" r="1" fill="currentColor" />
            <circle cx="4" cy="6" r="1" fill="currentColor" />
            <circle cx="8" cy="6" r="1" fill="currentColor" />
            <circle cx="4" cy="9" r="1" fill="currentColor" />
            <circle cx="8" cy="9" r="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="ml-1 inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-100 transition"
          onClick={() => onEdit(a)}
          title="Modifier"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
            <path d="M2 7.5l5-5 1.5 1.5-5 5L2 9.5V7.5z" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
          </svg>
          modifier
        </button>
      </div>
      <div className="mt-3 pt-3 border-t border-ink-800/60">
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-100 transition"
          onClick={() => onExpand(a.id)}
          aria-expanded={expanded}
        >
          <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
          Points de contrôle
        </button>
        {expanded && <BalanceCheckpointsDrawer accountId={a.id} currency={a.currency} />}
      </div>
    </div>
  );
}
