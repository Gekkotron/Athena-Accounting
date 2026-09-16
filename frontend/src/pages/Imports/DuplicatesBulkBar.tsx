import { useTranslation } from 'react-i18next';

// Cross-group bulk action bar rendered when selectedIds is non-empty.
// Extracted out of DuplicatesPanel so the panel stays under max-lines.
export function DuplicatesBulkBar({
  selectedIds, onClear,
  bulkMarkNotDupMut, bulkDeleteMut,
}: {
  selectedIds: Set<number>;
  onClear: () => void;
  bulkMarkNotDupMut: { mutate: (ids: number[]) => void; isPending: boolean };
  bulkDeleteMut: { mutate: (ids: number[]) => void; isPending: boolean };
}): JSX.Element {
  const { t } = useTranslation(['imports', 'common']);
  return (
    <div className="mb-3 rounded-lg border border-sage-800/40 bg-sage-900/15 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-ink-100">
        <span className="font-mono">{selectedIds.size}</span> {t('duplicates.selectedCount', { count: selectedIds.size })}
      </span>
      <div className="flex items-center gap-2">
        <button
          className="text-[11px] text-ink-500 hover:text-ink-100 transition"
          onClick={onClear}
        >
          {t('duplicates.clearSelection')}
        </button>
        <button
          className="text-xs text-sage-300 hover:text-sage-200 border border-sage-300/40 hover:border-sage-300 rounded-md px-2 py-1 transition disabled:opacity-40"
          disabled={bulkMarkNotDupMut.isPending || bulkDeleteMut.isPending}
          onClick={() => bulkMarkNotDupMut.mutate(Array.from(selectedIds))}
        >
          {t('duplicates.markNotDuplicate')}
        </button>
        <button
          className="text-xs text-clay-300 hover:text-clay-200 border border-clay-800/60 hover:border-clay-700 rounded-md px-2 py-1 transition disabled:opacity-40"
          disabled={bulkDeleteMut.isPending || bulkMarkNotDupMut.isPending}
          onClick={() => bulkDeleteMut.mutate(Array.from(selectedIds))}
        >
          {t('delete', { ns: 'common' })}
        </button>
      </div>
    </div>
  );
}
