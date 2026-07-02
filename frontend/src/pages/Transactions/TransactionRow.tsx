import type { Account, Category, Transaction } from '../../api/types';
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';

export function TransactionRow({
  tx,
  account,
  categories,
  onUpdateCategory,
  onUpdateNotes,
  onEdit,
  onDelete,
}: {
  tx: Transaction;
  account: Account | undefined;
  categories: Category[];
  onUpdateCategory: (id: number, patch: { categoryId: number | null }) => void;
  onUpdateNotes: (id: number, patch: { notes: string | null }) => void;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
}) {
  return (
    <tr className="group border-b border-ink-800/40 last:border-0 hover:bg-ink-850/40 transition">
      <td className="px-4 py-2.5 text-ink-300 whitespace-nowrap font-mono text-xs">{formatDate(tx.date)}</td>
      <td className="px-4 py-2.5 text-ink-400 whitespace-nowrap hidden sm:table-cell">{account?.name ?? '?'}</td>
      <td className="px-4 py-2.5 text-ink-100">
        <div className="truncate max-w-[18rem] md:max-w-md" title={tx.rawLabel}>
          {tx.rawLabel}
        </div>
        {tx.transferGroupId && (
          <div className="text-[11px] text-amber-300/80 mt-0.5 flex items-center gap-1">
            <span aria-hidden>↹</span> virement interne
          </div>
        )}
        <div className="sm:hidden text-[11px] text-ink-500 mt-0.5">{account?.name}</div>
      </td>
      <td className="px-4 py-2.5">
        <select
          className="input-sm"
          value={tx.categoryId ?? ''}
          disabled={!!tx.transferGroupId}
          onChange={(e) =>
            onUpdateCategory(tx.id, {
              categoryId: e.target.value ? Number(e.target.value) : null,
            })
          }
        >
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {tx.categorySource === 'manual' && <div className="text-[10px] text-ink-500 mt-1">manuel</div>}
      </td>
      <td className="px-4 py-2.5 hidden md:table-cell">
        <input
          defaultValue={tx.notes ?? ''}
          key={`notes-${tx.id}-${tx.notes ?? ''}`}
          placeholder="…"
          className="input-sm w-40 placeholder:text-ink-700"
          onBlur={(e) => {
            const v = e.target.value;
            const current = tx.notes ?? '';
            if (v !== current) {
              onUpdateNotes(tx.id, { notes: v || null });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') (e.target as HTMLInputElement).value = tx.notes ?? '';
          }}
        />
      </td>
      <td className={`px-4 py-2.5 text-right font-mono whitespace-nowrap tabular-nums ${amountSignClass(tx.amount)}`}>
        {formatAmount(tx.amount, account?.currency ?? 'EUR')}
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <div className="inline-flex gap-0.5">
          <button
            onClick={() => onEdit(tx)}
            className="p-1.5 rounded text-ink-600 hover:text-ink-100 hover:bg-ink-900 transition"
            title="Modifier"
            aria-label="Modifier"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2 10l6-6 2 2-6 6L2 12V10z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(tx)}
            className="p-1.5 rounded text-ink-600 hover:text-clay-300 hover:bg-ink-900 transition"
            title="Supprimer"
            aria-label="Supprimer"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 4h8M5.5 4V2.5h3V4M4 4l0.7 8h4.6L10 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}
