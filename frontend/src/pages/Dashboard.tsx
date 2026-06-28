import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Account, BalancePoint, Category, CategoryReportRow } from '../api/types';
import { formatAmount, amountSignClass } from '../lib/format';
import { BalanceChart } from '../components/BalanceChart';
import { CategoryDonut, type CategorySegment } from '../components/CategoryDonut';

type DonutMode = 'expense' | 'income';

export function Dashboard() {
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const balanceQ = useQuery({
    queryKey: ['reports', 'balance'],
    queryFn: () => api<{ perCurrency: { currency: string; total: string; account_count: number }[] }>(
      '/api/reports/balance',
    ),
  });
  const seriesQ = useQuery({
    queryKey: ['reports', 'timeseries'],
    queryFn: () => api<{ points: BalancePoint[] }>('/api/reports/timeseries', { query: { granularity: 'day' } }),
  });
  const catReportQ = useQuery({
    queryKey: ['reports', 'categories'],
    queryFn: () => api<{ rows: CategoryReportRow[] }>('/api/reports/categories'),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const currencies = balanceQ.data?.perCurrency ?? [];
  const accounts = accountsQ.data?.accounts ?? [];
  const primary = currencies[0];

  const [donutMode, setDonutMode] = useState<DonutMode>('expense');

  // Aggregate the per-category-per-month report into a single total per
  // category for the donut. Sign convention: expenses are stored negative; the
  // donut wants positive magnitudes, so we flip when in expense mode.
  const donutData: CategorySegment[] = useMemo(() => {
    const report = catReportQ.data?.rows ?? [];
    const cats = categoriesQ.data?.categories ?? [];
    const byCatId = new Map(cats.map((c) => [c.id, c] as const));
    const aggregated = new Map<number | null, number>();

    for (const row of report) {
      const amt = Number(row.total);
      if (!Number.isFinite(amt) || amt === 0) continue;
      if (donutMode === 'expense' && amt >= 0) continue;
      if (donutMode === 'income' && amt <= 0) continue;
      const prev = aggregated.get(row.category_id) ?? 0;
      aggregated.set(row.category_id, prev + amt);
    }

    return Array.from(aggregated.entries())
      .map(([catId, sum]) => {
        const c = catId !== null ? byCatId.get(catId) : null;
        return {
          id: catId,
          name: c?.name ?? 'Sans catégorie',
          color: c?.color ?? null,
          amount: Math.abs(sum),
        } satisfies CategorySegment;
      })
      .filter((s) => s.amount > 0);
  }, [catReportQ.data, categoriesQ.data, donutMode]);

  return (
    <div className="flex flex-col gap-10">
      {/* Hero */}
      <section>
        <div className="label">Solde net</div>
        {primary ? (
          <>
            <div className={`display text-5xl md:text-7xl leading-[1.05] mt-2 ${amountSignClass(primary.total)}`}>
              {formatAmount(primary.total, primary.currency)}
            </div>
            <div className="text-sm text-ink-500 mt-3">
              <span className="display-italic">somme</span> de {primary.account_count} compte
              {primary.account_count > 1 ? 's' : ''} · {primary.currency}
            </div>
          </>
        ) : (
          <div className="display text-5xl text-ink-700 mt-2">—</div>
        )}
      </section>

      {/* Other currencies */}
      {currencies.length > 1 && (
        <section className="flex flex-wrap gap-3">
          {currencies.slice(1).map((c) => (
            <div key={c.currency} className="surface-soft px-4 py-3">
              <div className="label">{c.currency}</div>
              <div className={`display text-xl mt-0.5 ${amountSignClass(c.total)}`}>
                {formatAmount(c.total, c.currency)}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Time series */}
      {currencies.length > 0 && (
        <section className="surface p-5 md:p-6">
          <div className="section-rule mb-4">Évolution · {primary?.currency}</div>
          {seriesQ.data && primary ? (
            <BalanceChart points={seriesQ.data.points} currency={primary.currency} />
          ) : (
            <div className="h-40 animate-pulse rounded-lg bg-ink-900" />
          )}
        </section>
      )}

      {/* Category breakdown — donut */}
      {currencies.length > 0 && (
        <section className="surface p-5 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div className="section-rule flex-1">
              Répartition par catégorie
            </div>
            <div className="inline-flex rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs">
              <button
                onClick={() => setDonutMode('expense')}
                className={`px-3 py-1.5 rounded-md transition ${
                  donutMode === 'expense'
                    ? 'bg-ink-850 text-ink-100'
                    : 'text-ink-400 hover:text-ink-100'
                }`}
              >
                Dépenses
              </button>
              <button
                onClick={() => setDonutMode('income')}
                className={`px-3 py-1.5 rounded-md transition ${
                  donutMode === 'income'
                    ? 'bg-ink-850 text-ink-100'
                    : 'text-ink-400 hover:text-ink-100'
                }`}
              >
                Revenus
              </button>
            </div>
          </div>
          {catReportQ.isLoading || categoriesQ.isLoading ? (
            <div className="h-60 animate-pulse rounded-lg bg-ink-900" />
          ) : (
            <CategoryDonut
              data={donutData}
              currency={primary?.currency ?? 'EUR'}
              centerLabel={donutMode === 'expense' ? 'Dépenses' : 'Revenus'}
            />
          )}
        </section>
      )}

      {/* Accounts breakdown */}
      <section>
        <div className="section-rule mb-4">Comptes</div>
        {accounts.length === 0 ? (
          <div className="surface p-6 text-sm text-ink-400">
            <span className="display-italic">Aucun compte</span> — commencez par en créer un dans l'onglet
            « Comptes ».
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {accounts.map((a) => (
              <div key={a.id} className="surface p-5 group hover:border-ink-700 transition">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-sm font-medium text-ink-100 truncate">{a.name}</div>
                  <span className="badge">{a.currency}</span>
                </div>
                <div className="text-[11px] text-ink-500 mt-0.5 uppercase tracking-wider">{a.type}</div>
                <div className={`display mt-4 text-3xl tabular-nums ${amountSignClass(a.currentBalance ?? '0')}`}>
                  {formatAmount(a.currentBalance ?? '0', a.currency)}
                </div>
                <div className="text-[11px] text-ink-500 mt-2 font-mono">
                  ouvert avec {formatAmount(a.openingBalance, a.currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
