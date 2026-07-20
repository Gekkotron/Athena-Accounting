import { useTranslation } from 'react-i18next';
import type { Category } from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';

interface Props {
  selectedIds: Set<number>;
  onClearSelection: () => void;
  bulkSelectValue: string;
  onBulkSelectValueChange: (v: string) => void;
  isBulkCategorizePending: boolean;
  onBulkCategorize: (categoryId: number | null) => void;
  sortedCategories: Category[];
  catById: Map<number, Category>;
  onStartBulkDelete: () => void;
}

export function BulkSelectionBar({
  selectedIds,
  onClearSelection,
  bulkSelectValue,
  onBulkSelectValueChange,
  isBulkCategorizePending,
  onBulkCategorize,
  sortedCategories,
  catById,
  onStartBulkDelete,
}: Props): JSX.Element {
  const { t } = useTranslation(['transactions', 'common']);
  return (
    <div className="rounded-lg border border-sage-800/40 bg-sage-900/15 px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-100">
        <span className="font-mono">{selectedIds.size}</span>{' '}
        {t('selection.suffix', { count: selectedIds.size })}
      </span>
      <div className="flex items-center gap-2">
        <button
          className="text-[11px] text-ink-500 hover:text-ink-100 transition"
          onClick={onClearSelection}
        >
          {t('selection.clear')}
        </button>
        <select
          className="input-sm"
          value={bulkSelectValue}
          disabled={isBulkCategorizePending}
          aria-label={t('selection.changeCategoryAriaLabel')}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            onBulkSelectValueChange('');
            onBulkCategorize(v === 'none' ? null : Number(v));
          }}
        >
          <option value="" disabled>{t('selection.categoryPlaceholder')}</option>
          <option value="none">{t('selection.categoryNone')}</option>
          {sortedCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {formatCategoryPath(c, catById)}
            </option>
          ))}
        </select>
        <button
          className="btn-secondary !py-1.5 !px-3 text-clay-300 hover:text-clay-200 border-clay-800/60 hover:border-clay-700"
          onClick={onStartBulkDelete}
        >
          {t('delete', { ns: 'common' })}
        </button>
      </div>
    </div>
  );
}
