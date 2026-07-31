import { useTranslation } from 'react-i18next';
import type { PendingDelete } from './useDeferredDelete';

// Bottom-center toast shown while a deletion sits in its undo window.
export function UndoToast({ pending, onUndo }: { pending: PendingDelete; onUndo: () => void }) {
  const { t } = useTranslation('transactions');
  const label =
    pending.kind === 'single'
      ? t('undo.deletedSingle')
      : t('undo.deletedBulk', { count: pending.ids.length });
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 surface flex items-center gap-4 px-4 py-3 shadow-xl"
    >
      <span className="text-sm text-ink-200">{label}</span>
      <button className="btn-secondary text-xs" onClick={onUndo}>
        {t('undo.action')}
      </button>
    </div>
  );
}
