import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Account, BalancePoint } from '../api/types';
import { formatAmount, amountSignClass, formatDate } from '../lib/format';
import { BalanceChart } from '../components/BalanceChart';
import { CategoryBreakdown } from '../components/CategoryBreakdown';

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

  const currencies = balanceQ.data?.perCurrency ?? [];
  const accounts = accountsQ.data?.accounts ?? [];
  const primary = currencies[0];

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
          <div className="section-rule mb-4">Répartition par catégorie</div>
          <CategoryBreakdown defaultRange="3m" currency={primary?.currency ?? 'EUR'} />
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
            {accounts.map((a) => {
              const current = Number(a.currentBalance ?? '0');
              const opening = Number(a.openingBalance);
              const delta = current - opening;
              const hasMovement = Math.abs(delta) >= 0.005;
              return (
                <div key={a.id} className="surface p-5 group hover:border-ink-700 transition">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-sm font-medium text-ink-100 truncate">{a.name}</div>
                    <span className="badge">{a.currency}</span>
                  </div>
                  <div className="text-[11px] text-ink-500 mt-0.5 uppercase tracking-wider">{a.type}</div>

                  <div className="mt-4">
                    <div className="label mb-0.5">Solde courant</div>
                    <div className={`display text-3xl tabular-nums ${amountSignClass(current)}`}>
                      {formatAmount(current, a.currency)}
                    </div>
                  </div>

                  <div className="text-[11px] text-ink-500 mt-3 font-mono leading-relaxed">
                    <div>
                      ouvert {formatDate(a.openingDate)} ·{' '}
                      {formatAmount(opening, a.currency)}
                    </div>
                    {hasMovement ? (
                      <div className={delta > 0 ? 'text-sage-400 mt-0.5' : 'text-clay-300 mt-0.5'}>
                        {delta > 0 ? '+' : ''}
                        {formatAmount(delta, a.currency)} depuis l'ouverture
                      </div>
                    ) : (
                      <div className="text-ink-600 mt-0.5 not-italic">aucun mouvement depuis</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
