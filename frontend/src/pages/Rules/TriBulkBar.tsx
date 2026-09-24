import { useTranslation } from 'react-i18next';
import type { Category } from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';
import { sortedCategoryOptions } from './tri-helpers';

export function TriBulkBar({
  categories,
  byId,
  bulkCategoryId,
  setBulkCategoryId,
  createRules,
  setCreateRules,
  selectedCount,
  totalGroups,
  assignPending,
  onAssignBulk,
  onSelectAll,
  onClearSelection,
}: {
  categories: Category[];
  byId: Map<number, Category>;
  bulkCategoryId: number | '';
  setBulkCategoryId: (v: number | '') => void;
  createRules: boolean;
  setCreateRules: (v: boolean) => void;
  selectedCount: number;
  totalGroups: number;
  assignPending: boolean;
  onAssignBulk: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}): JSX.Element {
  const { t } = useTranslation('rules');
  return (
    <div className="surface p-4 md:p-5 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[200px]">
        <label className="label mb-1.5 block">{t('tri.bulk.categoryLabel')}</label>
        <select
          className="input"
          value={bulkCategoryId}
          onChange={(e) => setBulkCategoryId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">—</option>
          {sortedCategoryOptions(categories, byId).map((c) => (
            <option key={c.id} value={c.id}>{formatCategoryPath(c, byId)}</option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-300 cursor-pointer">
        <input
          type="checkbox"
          checked={createRules}
          onChange={(e) => setCreateRules(e.target.checked)}
          className="h-4 w-4 rounded border-ink-700 bg-ink-900 accent-sage-300"
        />
        {t('tri.actions.createRule')}
      </label>
      <button
        className="btn-primary"
        onClick={onAssignBulk}
        disabled={!bulkCategoryId || selectedCount === 0 || assignPending}
      >
        {t('tri.actions.applyToSelection')} <span className="font-mono">{selectedCount}</span>{' '}
        {t('tri.actions.groupSuffix', { count: selectedCount })}
      </button>
      <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
        <button className="btn-ghost" onClick={onSelectAll} disabled={totalGroups === 0}>
          {t('tri.actions.selectAll')}
        </button>
        <button className="btn-ghost" onClick={onClearSelection} disabled={selectedCount === 0}>
          {t('tri.actions.clearSelection')}
        </button>
      </div>
    </div>
  );
}
