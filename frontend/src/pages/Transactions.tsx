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
  sort: 'date' | 'amount' | 'label';
  order: 'asc' | 'desc';
}

const PAGE = 50;

export function Transactions() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ sort: 'date', order: 'desc' });
  const [offset, setOffset] = useState(0);

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

  const accounts = accountsQ.data?.accounts ?? [];
  const categories = categoriesQ.data?.categories ?? [];
  const txs = txQ.data?.transactions ?? [];
  const total = txQ.data?.pagination.total ?? 0;

  const accountById = new Map(accounts.map((a) => [a.id, a] as const));
  const categoryById = new Map(categories.map((c) => [c.id, c] as const));

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setOffset(0);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-slate-500">{total.toLocaleString('fr-FR')} ligne(s) au total</p>
        </div>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="label">Recherche</label>
          <input
            className="input w-56"
            placeholder="libellé…"
            value={filters.search ?? ''}
            onChange={(e) => set('search', e.target.value || undefined)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="label">Compte</label>
          <select
            className="input w-44"
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
        <div className="flex flex-col gap-1">
          <label className="label">Catégorie</label>
          <select
            className="input w-44"
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
        <div className="flex flex-col gap-1">
          <label className="label">Du</label>
          <input
            type="date"
            className="input w-36"
            value={filters.fromDate ?? ''}
            onChange={(e) => set('fromDate', e.target.value || undefined)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="label">Au</label>
          <input
            type="date"
            className="input w-36"
            value={filters.toDate ?? ''}
            onChange={(e) => set('toDate', e.target.value || undefined)}
          />
        </div>
        <button
          className="btn-ghost"
          onClick={() => {
            setFilters({ sort: 'date', order: 'desc' });
            setOffset(0);
          }}
        >
          Effacer
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-slate-800 text-slate-500 text-xs uppercase tracking-wider">
              <Th sort="date" filters={filters} setFilters={setFilters} setOffset={setOffset}>
                Date
              </Th>
              <th className="px-4 py-3 font-normal">Compte</th>
              <Th sort="label" filters={filters} setFilters={setFilters} setOffset={setOffset}>
                Libellé
              </Th>
              <th className="px-4 py-3 font-normal">Catégorie</th>
              <Th sort="amount" filters={filters} setFilters={setFilters} setOffset={setOffset} align="right">
                Montant
              </Th>
            </tr>
          </thead>
          <tbody>
            {txs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {txQ.isLoading ? 'Chargement…' : 'Aucune transaction'}
                </td>
              </tr>
            ) : (
              txs.map((t) => {
                const acct = accountById.get(t.accountId);
                return (
                  <tr key={t.id} className="border-b border-slate-900 last:border-0 hover:bg-slate-900/30">
                    <td className="px-4 py-2 text-slate-300 whitespace-nowrap">{formatDate(t.date)}</td>
                    <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{acct?.name ?? '?'}</td>
                    <td className="px-4 py-2 text-slate-200">
                      <div className="truncate max-w-md" title={t.rawLabel}>
                        {t.rawLabel}
                      </div>
                      {t.transferGroupId && (
                        <div className="text-xs text-amber-400 mt-0.5">↹ virement interne</div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        className="input py-1 text-xs"
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
                      {t.categorySource === 'manual' && (
                        <span className="badge ml-1 text-[10px] py-0">manuel</span>
                      )}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono whitespace-nowrap ${amountSignClass(t.amount)}`}>
                      {formatAmount(t.amount, acct?.currency ?? 'EUR')}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-400">
        <div>
          {offset + 1}–{Math.min(offset + PAGE, total)} sur {total}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ‹ Précédent
          </button>
          <button
            className="btn-secondary"
            disabled={offset + PAGE >= total}
            onClick={() => setOffset(offset + PAGE)}
          >
            Suivant ›
          </button>
        </div>
      </div>

      {/* Suppress unused warning when categoryById has no rendered use */}
      <div className="hidden">{categoryById.size}</div>
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
      className={`px-4 py-3 font-normal cursor-pointer select-none ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => {
        setOffset(0);
        setFilters((f) => ({
          ...f,
          sort,
          order: f.sort === sort ? (f.order === 'asc' ? 'desc' : 'asc') : 'desc',
        }));
      }}
    >
      <span className={active ? 'text-slate-300' : ''}>
        {children}
        {active ? (filters.order === 'asc' ? ' ↑' : ' ↓') : ''}
      </span>
    </th>
  );
}
