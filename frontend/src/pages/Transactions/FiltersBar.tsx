import type { Account, Category } from '../../api/types';
import type { Filters } from './index';

// Try to interpret a search input as an amount. Accepts "338", "338€",
// "338,50", "338.50", "338,50 €", with optional leading minus. Returns the
// canonical "X.XX" form, or null when it's not a number.
function parseAmountQuery(raw: string): string | null {
  const cleaned = raw
    .replace(/€/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .trim();
  if (!cleaned) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}

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
  const searchIsAmount = parseAmountQuery(searchInput) !== null && searchInput.trim() !== '';

  return (
    <div className={`surface p-4 md:p-5 ${showAdvanced ? '' : 'hidden md:block'}`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
          <label className="label">Recherche</label>
          <div className="relative">
            <input
              className="input pr-20"
              placeholder="libellé ou montant (ex. 338)"
              value={searchInput}
              onChange={(e) => onSearchInputChange(e.target.value)}
            />
            {searchIsAmount && (
              <span
                className="absolute inset-y-0 right-2 my-auto h-5 inline-flex items-center rounded-md border border-sage-800/40 bg-sage-900/30 px-1.5 text-[10px] tracking-wide text-sage-200 font-mono"
                title="Filtré par montant (signe ignoré)"
              >
                MONTANT
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 w-full sm:w-44">
          <label className="label">Compte</label>
          <select
            className="input"
            value={filters.accountId ?? ''}
            onChange={(e) =>
              onFilterChange({ accountId: e.target.value ? Number(e.target.value) : undefined })
            }
          >
            <option value="">Tous</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 w-full sm:w-44">
          <label className="label">Catégorie</label>
          <select
            className="input"
            value={filters.categoryId ?? ''}
            onChange={(e) =>
              onFilterChange({ categoryId: e.target.value ? Number(e.target.value) : undefined })
            }
          >
            <option value="">Toutes</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 w-[48%] sm:w-36">
          <label className="label">Du</label>
          <input
            type="date"
            className="input"
            value={filters.fromDate ?? ''}
            onChange={(e) => onFilterChange({ fromDate: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1.5 w-[48%] sm:w-36">
          <label className="label">Au</label>
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
          Effacer
        </button>
      </div>
    </div>
  );
}
