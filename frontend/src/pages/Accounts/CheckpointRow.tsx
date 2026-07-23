import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAmount, parseDecimal } from '../../lib/format';
import type { BalanceCheckpoint } from '../../api/types';

export function CheckpointRow({
  cp,
  currency,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  cp: BalanceCheckpoint;
  currency: string;
  onSave: (patch: { expectedAmount?: string; note?: string | null }) => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
}) {
  const { t } = useTranslation(['accounts', 'common']);
  const [editingAmount, setEditingAmount] = useState(false);
  const [amountDraft, setAmountDraft] = useState(cp.expectedAmount);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(cp.note ?? '');

  const commitAmount = () => {
    // Route the typed value through parseDecimal so French "1500,00" is
    // normalized to the backend's canonical form before the PATCH; keep
    // the draft mounted for correction when the input can't be parsed.
    const parsed = parseDecimal(amountDraft);
    if (parsed == null) {
      setAmountDraft(cp.expectedAmount);
      setEditingAmount(false);
      return;
    }
    if (parsed !== cp.expectedAmount) {
      onSave({ expectedAmount: parsed });
    }
    setEditingAmount(false);
  };
  const commitNote = () => {
    const next = noteDraft.trim();
    const current = cp.note ?? '';
    if (next !== current) onSave({ note: next.length === 0 ? null : next });
    setEditingNote(false);
  };

  return (
    <tr className="border-t border-ink-800/60">
      <td className="py-1 text-ink-400">{cp.checkpointDate}</td>
      <td className="py-1 text-right text-ink-200 private">
        {editingAmount ? (
          <input
            className="input-sm w-24 text-right"
            autoFocus
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            onBlur={commitAmount}
            onKeyDown={(e) => e.key === 'Enter' && commitAmount()}
          />
        ) : (
          <button className="hover:text-ink-100" onClick={() => setEditingAmount(true)}>
            {formatAmount(cp.expectedAmount, currency)}
          </button>
        )}
      </td>
      <td className="py-1 pl-3 text-ink-500">
        {editingNote ? (
          <input
            className="input-sm w-full"
            autoFocus
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={commitNote}
            onKeyDown={(e) => e.key === 'Enter' && commitNote()}
          />
        ) : (
          <button className="text-left hover:text-ink-200 w-full" onClick={() => setEditingNote(true)}>
            {cp.note ?? <span className="italic text-ink-700">{t('checkpoints.row.addNote')}</span>}
          </button>
        )}
      </td>
      <td className="py-1 text-right">
        <button
          className="text-ink-600 hover:text-clay-300 transition"
          onClick={onDelete}
          disabled={deleting || saving}
          aria-label={t('delete', { ns: 'common' })}
          title={t('delete', { ns: 'common' })}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
