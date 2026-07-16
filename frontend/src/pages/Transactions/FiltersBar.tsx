import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Category } from '../../api/types';
import type { Filters } from './filters';
import { parseAmountQuery } from './parseAmountQuery';
import { formatCategoryPath } from '../../lib/categories';

export function FiltersBar({
  filters,
  searchInput,
  accounts,
  categories,
  showAdvanced,
  onFilterChange,
  onSearchInputChange,
}: {
  filters: Filters;
  searchInput: string;
  accounts: Account[];
  categories: Category[];
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onFilterChange: (patch: Partial<Filters>) => void;
  onSearchInputChange: (value: string) => void;
}) {
  const { t } = useTranslation('transactions');
  const byId = useMemo(
    () => new Map(categories.map((c) => [c.id, c] as const)),
    [categories],
  );
  const parsedAmount = searchInput.trim() === '' ? null : parseAmountQuery(searchInput);
  const searchIsAmount = parsedAmount !== null;
  // A bare integer widens to the whole euro server-side (19 -> 19,00–19,99).
  // Say so, so the range isn't a silent surprise. Explicit cents stay exact.
  const amountHint =
    parsedAmount === null
      ? ''
      : parsedAmount.includes('.')
        ? t('filters.amountHint.exact')
        : t('filters.amountHint.range', { amount: parsedAmount });

  return (
    <div className={`surface p-4 md:p-5 ${showAdvanced ? '' : 'hidden md:block'}`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
          <label className="label">{t('filters.labels.search')}</label>
          <div className="relative">
            <input
              className="input pr-20"
              placeholder={t('filters.placeholders.search')}
              value={searchInput}
              onChange={(e) => onSearchInputChange(e.target.value)}
            />
            {searchIsAmount && (
              <span
                className="absolute inset-y-0 right-2 my-auto h-5 inline-flex items-center rounded-md border border-sage-800/40 bg-sage-900/30 px-1.5 text-[10px] tracking-wide text-sage-200 font-mono"
                title={amountHint}
              >
                {t('filters.amountBadge')}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 w-full sm:w-44">
          <label className="label">{t('filters.labels.account')}</label>
          <select
            className="input"
            value={filters.accountId ?? ''}
            onChange={(e) =>
              onFilterChange({ accountId: e.target.value ? Number(e.target.value) : undefined })
            }
          >
            <option value="">{t('filters.options.allAccounts')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 w-full sm:w-44">
          <label className="label">{t('filters.labels.category')}</label>
          <select
            className="input"
            value={filters.categoryId ?? ''}
            onChange={(e) =>
              onFilterChange({ categoryId: e.target.value ? Number(e.target.value) : undefined })
            }
          >
            <option value="">{t('filters.options.allCategories')}</option>
            {[...categories]
              .sort((a, b) => {
                const pa = a.parentId != null ? byId.get(a.parentId)?.name ?? '' : a.name;
                const pb = b.parentId != null ? byId.get(b.parentId)?.name ?? '' : b.name;
                return pa.localeCompare(pb) || a.name.localeCompare(b.name);
              })
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {formatCategoryPath(c, byId)}
                </option>
              ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 w-[48%] sm:w-36">
          <label className="label">{t('filters.labels.fromDate')}</label>
          <input
            type="date"
            className="input"
            value={filters.fromDate ?? ''}
            onChange={(e) => onFilterChange({ fromDate: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1.5 w-[48%] sm:w-36">
          <label className="label">{t('filters.labels.toDate')}</label>
          <input
            type="date"
            className="input"
            value={filters.toDate ?? ''}
            onChange={(e) => onFilterChange({ toDate: e.target.value || undefined })}
          />
        </div>
        <button
          className="btn-ghost"
          onClick={() => {
            onFilterChange({
              accountId: undefined,
              categoryId: undefined,
              sourceFileId: undefined,
              fromDate: undefined,
              toDate: undefined,
              search: undefined,
              amount: undefined,
              sort: 'date',
              order: 'desc',
            });
            onSearchInputChange('');
          }}
        >
          {t('filters.actions.clear')}
        </button>
      </div>
    </div>
  );
}
