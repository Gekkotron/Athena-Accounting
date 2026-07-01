import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Account, BalancePoint, BalanceCheckpoint } from '../api/types';
import { listCheckpoints } from '../api/checkpoints';
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

  // Chart scope: 'all' = sum across all accounts of the primary currency,
  // otherwise a specific account_id (the chart then shows that single account
  // in its own currency).
  const [chartScope, setChartScope] = useState<'all' | number>('all');

  // Checkpoints for the currently scoped account. Skipped entirely when scope
  // is 'all' — checkpoints are per-account by design.
  const checkpointsQ = useQuery({
    queryKey: ['balance-checkpoints', chartScope],
    queryFn: () => listCheckpoints(chartScope as number),
    enabled: chartScope !== 'all',
  });

  const chartCheckpoints = useMemo(() => {
    if (chartScope === 'all') return undefined;
    const raw = checkpointsQ.data?.checkpoints ?? [];
    return raw.map((c: BalanceCheckpoint) => ({
      date: c.checkpointDate,
      expectedAmount: Number(c.expectedAmount),
      note: c.note ?? undefined,
    }));
  }, [checkpointsQ.data, chartScope]);

  const chartCurrency = useMemo(() => {
    if (chartScope === 'all') return primary?.currency ?? 'EUR';
    const acc = accounts.find((a) => a.id === chartScope);
    return acc?.currency ?? primary?.currency ?? 'EUR';
  }, [chartScope, accounts, primary]);

  // Only feed the chart points matching the chosen scope. BalanceChart already
  // filters by currency on top of this, so cross-currency rows are dropped too.
  const chartPoints = useMemo<BalancePoint[]>(() => {
    const all = seriesQ.data?.points ?? [];
    if (chartScope === 'all') return all;
    return all.filter((p) => p.account_id === chartScope);
  }, [seriesQ.data, chartScope]);

  return (
    <div className="flex flex-col gap-10">
      {/* Hero */}
      <section>
        <div className="label">Solde net</div>
        {primary ? (
          <>
            <div className={`display text-5xl md:text-7xl leading-[1.05] mt-2 tabular-nums ${amountSignClass(primary.total)}`}>
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
              <div className={`display text-xl mt-0.5 tabular-nums ${amountSignClass(c.total)}`}>
                {formatAmount(c.total, c.currency)}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Time series */}
      {currencies.length > 0 && (
        <section className="surface p-5 md:p-6">
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
            <div className="section-rule flex-1">Évolution · {chartCurrency}</div>
            <select
              className="input-sm w-full sm:w-56"
              value={chartScope === 'all' ? 'all' : String(chartScope)}
              onChange={(e) =>
                setChartScope(e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
              aria-label="Compte affiché"
            >
              <option value="all">Tous les comptes ({primary?.currency})</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>
          {seriesQ.data && primary ? (
            <BalanceChart points={chartPoints} currency={chartCurrency} checkpoints={chartCheckpoints} />
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
              const total = a.transactionCount ?? 0;
              const counted = a.countedTransactionCount ?? 0;
              const excluded = total - counted;
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
                      <span className="private">{formatAmount(opening, a.currency)}</span>
                    </div>
                    {hasMovement ? (
                      <div className={delta > 0 ? 'text-sage-400 mt-0.5' : 'text-clay-300 mt-0.5'}>
                        <span className="private">
                          {delta > 0 ? '+' : ''}
                          {formatAmount(delta, a.currency)}
                        </span>{' '}
                        depuis l'ouverture
                      </div>
                    ) : (
                      <div className="text-ink-600 mt-0.5 not-italic">aucun mouvement depuis</div>
                    )}
                  </div>

                  <div className="text-[11px] text-ink-500 mt-3 pt-3 border-t border-ink-800/60 flex items-baseline justify-between gap-2">
                    <Link
                      to={`/transactions?accountId=${a.id}`}
                      className="text-ink-400 hover:text-ink-100 transition"
                    >
                      <span className="font-mono">{total}</span> transaction{total > 1 ? 's' : ''}
                      {' '}<span className="text-ink-600">→</span>
                    </Link>
                    {excluded > 0 && (
                      <span
                        className="text-amber-300/80"
                        title={`${excluded} transaction(s) datée(s) avant la date d'ouverture, exclue(s) du calcul.`}
                      >
                        <span className="font-mono">{excluded}</span> hors période
                      </span>
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
