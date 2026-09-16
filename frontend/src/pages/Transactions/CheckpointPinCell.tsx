import { useTranslation } from 'react-i18next';
import type { Account, BalanceCheckpoint, Transaction } from '../../api/types';
import { formatAmount, formatDate } from '../../lib/format';

// The right-most column of the desktop transactions table when a single
// account is selected: shows the running balance and, on end-of-day rows,
// a pin button that toggles a manual balance checkpoint. Extracted from
// TransactionRow so the row itself stays under the max-lines cap.
export function CheckpointPinCell({
  tx, account, isEndOfDay, checkpoint, checkpointPending,
  onToggleCheckpoint, checkpointDrifted, driftMessage,
}: {
  tx: Transaction;
  account: Account | undefined;
  isEndOfDay: boolean;
  checkpoint: BalanceCheckpoint | undefined;
  checkpointPending: boolean;
  onToggleCheckpoint: (tx: Transaction, checked: boolean) => void;
  checkpointDrifted: boolean;
  driftMessage: string | null;
}): JSX.Element {
  const { t } = useTranslation(['transactions', 'common']);
  return (
    <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap tabular-nums text-ink-300">
      <span className="inline-flex items-center justify-end gap-2">
        {isEndOfDay && tx.runningBalance != null && (
          <button
            type="button"
            onClick={() => onToggleCheckpoint(tx, !(checkpoint != null))}
            disabled={checkpointPending}
            aria-pressed={checkpoint != null}
            aria-label={`${t('row.checkpointAriaLabel', { date: formatDate(tx.date) })}${driftMessage ? ` — ${driftMessage}` : ''}`}
            title={driftMessage ?? t('row.checkpointTitle')}
            className={`inline-flex items-center gap-0.5 rounded p-0.5 transition disabled:opacity-40 disabled:cursor-wait ${
              checkpoint != null
                ? checkpointDrifted
                  ? 'text-amber-300 hover:text-amber-200'
                  : 'text-sage-300 hover:text-sage-200'
                : 'text-ink-600 hover:text-sage-300 hover:bg-ink-900'
            }`}
          >
            {checkpointDrifted && (
              <span className="text-[10px] font-bold leading-none" aria-hidden>!</span>
            )}
            {checkpoint != null ? (
              <svg width="11" height="13" viewBox="0 0 12 14" fill="currentColor" aria-hidden>
                <path d="M2 1h8v11.2L6 9.6 2 12.2z" />
              </svg>
            ) : (
              <svg width="11" height="13" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
                <path d="M2.5 1.5h7v9.7L6 9.05 2.5 11.2z" />
              </svg>
            )}
          </button>
        )}
        <span>{tx.runningBalance != null ? formatAmount(tx.runningBalance, account?.currency ?? 'EUR') : '—'}</span>
      </span>
    </td>
  );
}
