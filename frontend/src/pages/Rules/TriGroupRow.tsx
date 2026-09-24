import { useTranslation } from 'react-i18next';
import type { Category, TriGroup } from '../../api/types';
import { formatAmount, formatDate, amountSignClass } from '../../lib/format';
import { formatCategoryPath } from '../../lib/categories';
import { sortedCategoryOptions } from './tri-helpers';

export function TriGroupRow({
  g,
  selected,
  localCategoryId,
  categories,
  byId,
  onToggleSelect,
  onSetGroupCategory,
  onClearGroupCategory,
  onAssignRow,
  assignPending,
}: {
  g: TriGroup;
  selected: boolean;
  localCategoryId: number | undefined;
  categories: Category[];
  byId: Map<number, Category>;
  onToggleSelect: () => void;
  onSetGroupCategory: (categoryId: number) => void;
  onClearGroupCategory: () => void;
  onAssignRow: () => void;
  assignPending: boolean;
}): JSX.Element {
  const { t } = useTranslation('rules');
  return (
    <tr
      className={`border-b border-ink-800/40 last:border-0 transition ${
        selected ? 'bg-sage-900/15' : 'hover:bg-ink-850/40'
      }`}
    >
      <td className="px-4 py-2.5" data-hide-mobile>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-ink-700 bg-ink-900 accent-sage-300"
        />
      </td>
      <td className="px-4 py-2.5 text-ink-100 font-mono text-xs max-w-[200px] truncate">{g.normalized_label}</td>
      <td className="px-4 py-2.5 text-ink-400 text-xs truncate max-w-xs hidden lg:table-cell" title={g.example_raw_label}>
        {g.example_raw_label}
      </td>
      <td className="px-4 py-2.5 text-right text-ink-200 font-mono hidden sm:table-cell">{g.transaction_count}</td>
      <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${amountSignClass(g.total_amount)}`}>
        {formatAmount(g.total_amount, 'EUR')}
      </td>
      <td className="px-4 py-2.5 text-ink-500 text-[11px] font-mono whitespace-nowrap hidden md:table-cell">
        {formatDate(g.min_date)} → {formatDate(g.max_date)}
      </td>
      <td className="px-4 py-2.5">
        <select
          className="input-sm"
          value={localCategoryId ?? ''}
          onChange={(e) =>
            e.target.value ? onSetGroupCategory(Number(e.target.value)) : onClearGroupCategory()
          }
        >
          <option value="">—</option>
          {sortedCategoryOptions(categories, byId).map((c) => (
            <option key={c.id} value={c.id}>{formatCategoryPath(c, byId)}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5 text-right">
        <button
          className="text-xs text-sage-300 hover:text-sage-200 disabled:opacity-40 disabled:hover:text-sage-300 transition"
          disabled={!localCategoryId || assignPending}
          onClick={onAssignRow}
        >
          {t('tri.actions.applyRow')}
        </button>
      </td>
    </tr>
  );
}
