import type { Account } from '../../api/types';
import { formatAmount, amountSignClass, formatDate } from '../../lib/format';
import { BalanceCheckpointsDrawer } from './BalanceCheckpointsDrawer';

export function AccountCard({
  account: a,
  onEdit,
  onExpand,
  expanded,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  moving,
}: {
  account: Account;
  onEdit: (account: Account) => void;
  onExpand: (id: number) => void;
  expanded: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  moving: boolean;
}) {
  return (
    <div className="surface p-5 relative group">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium text-ink-100 truncate">{a.name}</div>
        <span className="badge">{a.currency}</span>
      </div>
      <div className="label mt-0.5">{a.type}</div>
      <div className={`display mt-4 text-3xl tabular-nums ${amountSignClass(a.currentBalance ?? '0')}`}>
        {formatAmount(a.currentBalance ?? '0', a.currency)}
      </div>
      <div className="text-[11px] text-ink-500 mt-3 font-mono leading-relaxed">
        ouvert {formatDate(a.openingDate)} ·{' '}
        <span className="private">{formatAmount(a.openingBalance, a.currency)}</span>
      </div>
      {/* Top-right cluster: reorder up/down + modify */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <button
          className="p-1 rounded text-ink-600 hover:text-ink-100 hover:bg-ink-900 transition disabled:opacity-30 disabled:hover:text-ink-600 disabled:hover:bg-transparent"
          onClick={onMoveUp}
          disabled={!canMoveUp || moving}
          title="Monter"
          aria-label="Déplacer vers le haut"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M3 7l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="p-1 rounded text-ink-600 hover:text-ink-100 hover:bg-ink-900 transition disabled:opacity-30 disabled:hover:text-ink-600 disabled:hover:bg-transparent"
          onClick={onMoveDown}
          disabled={!canMoveDown || moving}
          title="Descendre"
          aria-label="Déplacer vers le bas"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
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
