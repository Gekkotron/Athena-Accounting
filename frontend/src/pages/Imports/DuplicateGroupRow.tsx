import { useTranslation } from 'react-i18next';
import type { Account } from '../../api/types';
import { getAccountName } from '../../lib/accounts';

interface DupTx {
  id: number;
  raw_label: string;
  normalized_label: string;
  source_file_id: number | null;
  category_id: number | null;
}
interface DupGroup {
  accountId: number;
  date: string;
  amount: string;
  transactions: DupTx[];
}

// One table row per (account, date, amount) duplicate cluster. Extracted
// out of DuplicatesPanel so the panel itself stays under the ESLint
// max-lines cap and each row can be reasoned about in isolation.
export function DuplicateGroupRow({
  group, similarity, accounts,
  selectedIds, onToggleSelect,
  confirmDeleteTxId, setConfirmDeleteTxId,
  dupDeleteError, setDupDeleteError,
  deleteTxMut, markNotDuplicateMut,
}: {
  group: DupGroup;
  similarity: number;
  accounts: Account[];
  selectedIds: Set<number>;
  onToggleSelect: (id: number, checked: boolean) => void;
  confirmDeleteTxId: number | null;
  setConfirmDeleteTxId: (id: number | null) => void;
  dupDeleteError: string | null;
  setDupDeleteError: (v: string | null) => void;
  deleteTxMut: { mutate: (id: number) => void; isPending: boolean };
  markNotDuplicateMut: { mutate: (ids: number[]) => void; isPending: boolean };
}): JSX.Element {
  const { t } = useTranslation(['imports', 'common']);
  const g = group;
  return (
    <tr className="border-b border-ink-800/40 last:border-0 align-top">
      <td className="px-4 py-2.5 text-ink-300">{getAccountName(accounts, g.accountId)}</td>
      <td className="px-4 py-2.5 text-ink-300 font-mono text-xs whitespace-nowrap">{g.date}</td>
      <td className="px-4 py-2.5 text-right font-mono text-ink-100">
        {Number(g.amount).toFixed(2).replace('.', ',')} €
      </td>
      <td className="px-4 py-2.5">
        <ul className="space-y-1">
          {g.transactions.map((tx) => {
            const confirming = confirmDeleteTxId === tx.id;
            return (
              <li key={tx.id} className="flex items-baseline gap-2">
                <input
                  type="checkbox"
                  className="accent-sage-300"
                  checked={selectedIds.has(tx.id)}
                  onChange={(e) => onToggleSelect(tx.id, e.target.checked)}
                  aria-label={t('duplicates.selectTransactionAriaLabel', { id: tx.id })}
                />
                <code className="text-xs text-ink-500 min-w-[3.5rem]">#{tx.id}</code>
                <span className="font-mono text-xs text-ink-100 flex-1">{tx.raw_label}</span>
                {confirming ? (
                  <span className="flex items-center gap-1">
                    <button
                      className="px-2 py-0.5 rounded-md bg-clay-300 text-ink-950 text-xs font-medium hover:bg-clay-200 transition disabled:opacity-40"
                      disabled={deleteTxMut.isPending}
                      onClick={() => deleteTxMut.mutate(tx.id)}
                    >{deleteTxMut.isPending ? '…' : t('delete', { ns: 'common' })}</button>
                    <button
                      className="px-2 py-0.5 rounded-md border border-ink-700 text-ink-200 text-xs hover:bg-ink-850 transition"
                      onClick={() => { setConfirmDeleteTxId(null); setDupDeleteError(null); }}
                    >{t('cancel', { ns: 'common' })}</button>
                  </span>
                ) : (
                  <button
                    className="text-ink-500 hover:text-clay-300 transition px-1"
                    onClick={() => { setConfirmDeleteTxId(tx.id); setDupDeleteError(null); }}
                    title={t('duplicates.deleteTransactionTitle', { id: tx.id })}
                    aria-label={t('duplicates.deleteTransactionAriaLabel')}
                  >🗑</button>
                )}
              </li>
            );
          })}
        </ul>
        {dupDeleteError && confirmDeleteTxId !== null &&
          g.transactions.some((tx) => tx.id === confirmDeleteTxId) && (
            <p className="mt-2 text-xs text-clay-300">{dupDeleteError}</p>
          )}
      </td>
      <td className="px-4 py-2.5 text-right align-top font-mono text-xs text-ink-400" title={t('duplicates.similarityTitle')}>
        {Math.round(similarity * 100)}%
      </td>
      <td className="px-4 py-2.5 text-right align-top">
        <button
          className="text-xs text-sage-300 hover:text-sage-200 border border-sage-300/40 hover:border-sage-300 rounded-md px-2 py-1 transition disabled:opacity-40"
          disabled={markNotDuplicateMut.isPending}
          onClick={() => markNotDuplicateMut.mutate(g.transactions.map((tx) => tx.id))}
          title={t('duplicates.markNotDuplicateTitle')}
        >
          {t('duplicates.markNotDuplicate')}
        </button>
      </td>
    </tr>
  );
}
