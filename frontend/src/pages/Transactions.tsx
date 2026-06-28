import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Account, Category, Transaction } from '../api/types';
import { formatAmount, formatDate, amountSignClass } from '../lib/format';

interface Filters {
  accountId?: number;
  categoryId?: number;
  fromDate?: string;
  toDate?: string;
  search?: string;
  amount?: string;
  sort: 'date' | 'amount' | 'label';
  order: 'asc' | 'desc';
}

const PAGE = 50;

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

export function Transactions() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ sort: 'date', order: 'desc' });
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Whenever the search input changes, route it to either `amount` or
  // `search`. We never send both at once.
  const onSearchChange = (value: string) => {
    setSearchInput(value);
    setOffset(0);
    const amt = parseAmountQuery(value);
    if (amt !== null) {
      setFilters((f) => ({ ...f, amount: amt, search: undefined }));
    } else {
      setFilters((f) => ({ ...f, amount: undefined, search: value || undefined }));
    }
  };
  const searchIsAmount = parseAmountQuery(searchInput) !== null && searchInput.trim() !== '';

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const txQ = useQuery({
    queryKey: ['transactions', filters, offset],
    queryFn: () =>
      api<{
        transactions: Transaction[];
        pagination: { total: number; limit: number; offset: number };
      }>('/api/transactions', {
        query: { ...filters, limit: PAGE, offset },
      }),
  });

  const updateCategory = useMutation({
    mutationFn: ({ id, categoryId }: { id: number; categoryId: number | null }) =>
      api<{ transaction: Transaction }>(`/api/transactions/${id}`, {
        method: 'PATCH',
        json: { categoryId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });

  const updateNotes = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string | null }) =>
      api<{ transaction: Transaction }>(`/api/transactions/${id}`, {
        method: 'PATCH',
        json: { notes },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const categories = categoriesQ.data?.categories ?? [];
  const txs = txQ.data?.transactions ?? [];
  const total = txQ.data?.pagination.total ?? 0;

  const accountById = new Map(accounts.map((a) => [a.id, a] as const));

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setOffset(0);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">{total.toLocaleString('fr-FR')} ligne{total > 1 ? 's' : ''} au total</p>
        </div>
        <button className="btn-secondary md:hidden" onClick={() => setShowFilters((s) => !s)}>
          {showFilters ? 'Masquer' : 'Filtres'}
        </button>
      </div>

      <div className={`surface p-4 md:p-5 ${showFilters ? '' : 'hidden md:block'}`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
            <label className="label">Recherche</label>
            <div className="relative">
              <input
                className="input pr-20"
                placeholder="libellé ou montant (ex. 338)"
                value={searchInput}
                onChange={(e) => onSearchChange(e.target.value)}
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
              onChange={(e) => set('accountId', e.target.value ? Number(e.target.value) : undefined)}
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
              onChange={(e) => set('categoryId', e.target.value ? Number(e.target.value) : undefined)}
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
              onChange={(e) => set('fromDate', e.target.value || undefined)}
            />
          </div>
          <div className="flex flex-col gap-1.5 w-[48%] sm:w-36">
            <label className="label">Au</label>
            <input
              type="date"
              className="input"
              value={filters.toDate ?? ''}
              onChange={(e) => set('toDate', e.target.value || undefined)}
            />
          </div>
          <button
            className="btn-ghost"
            onClick={() => {
              setFilters({ sort: 'date', order: 'desc' });
              setSearchInput('');
              setOffset(0);
            }}
          >
            Effacer
          </button>
        </div>
      </div>

      <div className="surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <Th sort="date" filters={filters} setFilters={setFilters} setOffset={setOffset}>Date</Th>
                <th className="px-4 py-3 label font-normal hidden sm:table-cell">Compte</th>
                <Th sort="label" filters={filters} setFilters={setFilters} setOffset={setOffset}>Libellé</Th>
                <th className="px-4 py-3 label font-normal">Catégorie</th>
                <th className="px-4 py-3 label font-normal hidden md:table-cell">Notes</th>
                <Th sort="amount" filters={filters} setFilters={setFilters} setOffset={setOffset} align="right">Montant</Th>
              </tr>
            </thead>
            <tbody>
              {txs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-500 display-italic">
                    {txQ.isLoading ? 'Chargement…' : 'Aucune transaction.'}
                  </td>
                </tr>
              ) : (
                txs.map((t) => {
                  const acct = accountById.get(t.accountId);
                  return (
                    <tr key={t.id} className="border-b border-ink-800/40 last:border-0 hover:bg-ink-850/40 transition">
                      <td className="px-4 py-2.5 text-ink-300 whitespace-nowrap font-mono text-xs">{formatDate(t.date)}</td>
                      <td className="px-4 py-2.5 text-ink-400 whitespace-nowrap hidden sm:table-cell">{acct?.name ?? '?'}</td>
                      <td className="px-4 py-2.5 text-ink-100">
                        <div className="truncate max-w-[18rem] md:max-w-md" title={t.rawLabel}>
                          {t.rawLabel}
                        </div>
                        {t.transferGroupId && (
                          <div className="text-[11px] text-amber-300/80 mt-0.5 flex items-center gap-1">
                            <span aria-hidden>↹</span> virement interne
                          </div>
                        )}
                        <div className="sm:hidden text-[11px] text-ink-500 mt-0.5">{acct?.name}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          className="input-sm"
                          value={t.categoryId ?? ''}
                          disabled={!!t.transferGroupId}
                          onChange={(e) =>
                            updateCategory.mutate({
                              id: t.id,
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
                        {t.categorySource === 'manual' && <div className="text-[10px] text-ink-500 mt-1">manuel</div>}
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <input
                          defaultValue={t.notes ?? ''}
                          key={`notes-${t.id}-${t.notes ?? ''}`}
                          placeholder="…"
                          className="input-sm w-40 placeholder:text-ink-700"
                          onBlur={(e) => {
                            const v = e.target.value;
                            const current = t.notes ?? '';
                            if (v !== current) {
                              updateNotes.mutate({ id: t.id, notes: v || null });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') (e.target as HTMLInputElement).value = t.notes ?? '';
                          }}
                        />
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono whitespace-nowrap tabular-nums ${amountSignClass(t.amount)}`}>
                        {formatAmount(t.amount, acct?.currency ?? 'EUR')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-ink-400">
        <div className="font-mono text-xs">
          {total === 0 ? '0–0' : `${offset + 1}–${Math.min(offset + PAGE, total)}`} sur {total}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ‹
          </button>
          <button className="btn-secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            ›
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({
  children,
  sort,
  filters,
  setFilters,
  setOffset,
  align = 'left',
}: {
  children: React.ReactNode;
  sort: Filters['sort'];
  filters: Filters;
  setFilters: (fn: (f: Filters) => Filters) => void;
  setOffset: (n: number) => void;
  align?: 'left' | 'right';
}) {
  const active = filters.sort === sort;
  return (
    <th
      className={`px-4 py-3 label font-normal cursor-pointer select-none whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => {
        setOffset(0);
        setFilters((f) => ({
          ...f,
          sort,
          order: f.sort === sort ? (f.order === 'asc' ? 'desc' : 'asc') : 'desc',
        }));
      }}
    >
      <span className={active ? 'text-ink-100' : ''}>
        {children}
        {active ? (filters.order === 'asc' ? ' ↑' : ' ↓') : ''}
      </span>
    </th>
  );
}
