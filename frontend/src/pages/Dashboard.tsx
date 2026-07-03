import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Account, BalancePoint, BalanceCheckpoint, CategoryReportRow } from '../api/types';
import { listCheckpoints } from '../api/checkpoints';
import { formatAmount, amountSignClass, formatDate } from '../lib/format';
import { usePersistedState } from '../lib/persisted-state';
import { BalanceChart } from '../components/BalanceChart';
import { CategoryBreakdown } from '../components/CategoryBreakdown';
import { StatWidget } from '../components/StatWidget';

// Look back N complete months (excludes the current month, since a
// half-finished month drags the average toward zero).
const AVG_WINDOW_MONTHS = 12;

function monthAgoISODate(monthsBack: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
function firstOfCurrentMonthISODate(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function Dashboard() {
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const balanceQ = useQuery({
    queryKey: ['reports', 'balance'],
    queryFn: () => api<{ perCurrency: { currency: string; total: string; available: string; account_count: number }[] }>(
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
  // in its own currency). Persisted so the last-picked scope survives reloads.
  const [chartScope, setChartScope] = usePersistedState<'all' | number>(
    'dashboard.chartScope',
    'all',
  );

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

  // Monthly aggregate window for the stat widgets. Skips the current
  // half-month so a mid-month view isn't dragged down.
  const statsFromDate = monthAgoISODate(AVG_WINDOW_MONTHS);
  const statsToDate = firstOfCurrentMonthISODate();
  const statsQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate: statsFromDate, toDate: statsToDate }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: { fromDate: statsFromDate, toDate: statsToDate },
      }),
  });

  const monthlyStats = useMemo(() => {
    const rows = statsQ.data?.rows ?? [];
    // Aggregate signed totals per month.
    // - Expenses accumulate as negative amounts (their `total` is < 0).
    // - Incomes accumulate as positive amounts.
    // We split by category_kind so a transfer/uncategorized row with a
    // negative amount doesn't get double-counted.
    const monthly = new Map<string, { spend: number; income: number }>();
    for (const r of rows) {
      const cur = monthly.get(r.month) ?? { spend: 0, income: 0 };
      const amount = Number(r.total);
      if (!Number.isFinite(amount)) continue;
      if (r.category_kind === 'expense' || (r.category_kind == null && amount < 0)) {
        cur.spend += amount;
      } else if (r.category_kind === 'income' || (r.category_kind == null && amount > 0)) {
        cur.income += amount;
      }
      monthly.set(r.month, cur);
    }
    // If the user has no months of history yet, avoid dividing by zero.
    const monthCount = monthly.size || 1;
    let totalSpend = 0;
    let totalIncome = 0;
    for (const v of monthly.values()) {
      totalSpend += v.spend;
      totalIncome += v.income;
    }
    return {
      monthCount: monthly.size,
      avgSpend: totalSpend / monthCount,   // negative or zero
      avgIncome: totalIncome / monthCount, // positive or zero
      avgSavings: (totalIncome + totalSpend) / monthCount, // income - |spend|
    };
  }, [statsQ.data]);

  const showStats =
    !statsQ.isLoading && monthlyStats.monthCount > 0 && !!primary;

  return (
    <div className="flex flex-col gap-10">
      {/* Hero */}
      <section>
        {primary ? (
          (() => {
            const total = Number(primary.total);
            const available = Number(primary.available ?? primary.total);
            const blocked = total - available;
            const hasBlocked = Math.abs(blocked) >= 0.005;
            return (
              <>
                <div className="label">{hasBlocked ? 'Disponible' : 'Solde net'}</div>
                <div className={`display text-5xl md:text-7xl leading-[1.05] mt-2 tabular-nums ${amountSignClass(available)}`}>
                  {formatAmount(available, primary.currency)}
                </div>
                <div className="text-sm text-ink-500 mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span>
                    <span className="display-italic">somme</span> de {primary.account_count} compte
                    {primary.account_count > 1 ? 's' : ''} · {primary.currency}
                  </span>
                  {hasBlocked && (
                    <span className="text-amber-300/90">
                      + <span className="font-mono private">{formatAmount(blocked, primary.currency)}</span> bloqués
                    </span>
                  )}
                </div>
              </>
            );
          })()
        ) : (
          <>
            <div className="label">Solde net</div>
            <div className="display text-5xl text-ink-700 mt-2">—</div>
          </>
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

      {/* Monthly stat widgets — reusable StatWidget primitive. Add more
          instances here as new stats come up. */}
      {showStats && (
        <section>
          <div className="section-rule mb-4">
            Moyennes mensuelles{' '}
            <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
              — sur {monthlyStats.monthCount} mois glissant{monthlyStats.monthCount > 1 ? 's' : ''}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <StatWidget
              icon="💸"
              label="Dépense moyenne mensuelle"
              value={monthlyStats.avgSpend}
              currency={primary!.currency}
              tone="clay"
              hint="Moyenne des dépenses catégorisées « expense » (hors virements internes)."
            />
            <StatWidget
              icon="💰"
              label="Revenu moyen mensuel"
              value={monthlyStats.avgIncome}
              currency={primary!.currency}
              tone="sage"
              hint="Moyenne des transactions catégorisées « income »."
            />
            <StatWidget
              icon="📈"
              label="Épargne moyenne mensuelle"
              value={monthlyStats.avgSavings}
              currency={primary!.currency}
              tone="auto"
              hint="Revenus − dépenses, moyenne mensuelle."
            />
          </div>
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
              const available = Number(a.availableBalance ?? a.currentBalance ?? '0');
              const blocked = current - available;
              const hasBlocked = Math.abs(blocked) >= 0.005;
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
                    {hasBlocked && (
                      <div className="text-[11px] text-amber-300/90 mt-1 font-mono">
                        dont <span className="private">{formatAmount(blocked, a.currency)}</span> bloqués
                        {a.lockYears != null && (
                          <span className="text-ink-500"> · {a.lockYears} an{a.lockYears > 1 ? 's' : ''}</span>
                        )}
                      </div>
                    )}
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
