import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account, BalancePoint, BalanceCheckpoint } from '../../api/types';
import { listCheckpoints } from '../../api/checkpoints';
import { formatAmount, amountSignClass } from '../../lib/format';
import { useSettings } from '../../lib/useSettings';
import { BalanceChart } from '../../components/BalanceChart';
import { CategoryBreakdown } from '../../components/CategoryBreakdown';
import { RangePicker, fromDateFor, type RangeKey } from '../../components/RangePicker';
import { DashboardHero } from './DashboardHero';
import { MoyennesMensuellesSection } from './MoyennesMensuellesSection';
import { InsightsSection } from './InsightsSection';
import { SankeySection } from './SankeySection';

export function Dashboard(): JSX.Element {
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const balanceQ = useQuery({
    queryKey: ['reports', 'balance'],
    queryFn: () => api<{ perCurrency: { currency: string; total: string; available: string; invested: string; account_count: number }[] }>(
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

  // Page-wide period and chart scope. Both seeded from user settings on
  // mount; in-session changes are ephemeral (no writeback). To make a
  // change stick, edit Réglages.
  const { settings, isReady } = useSettings();
  const [range, setRange] = useState<RangeKey>(settings.dashboardRange);
  const [chartScope, setChartScope] = useState<'all' | number>(settings.dashboardChartScope);
  // If settings arrive after the initial render (first paint used DEFAULTS),
  // hydrate the local state once — gated on isReady so we don't latch onto
  // the DEFAULTS fallback while the settings query is still loading.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !isReady) return;
    hydrated.current = true;
    setRange(settings.dashboardRange);
    setChartScope(settings.dashboardChartScope);
  }, [isReady, settings.dashboardRange, settings.dashboardChartScope]);
  const rangeFromDate = fromDateFor(range);

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
  // Range window applied client-side (backend returns the whole series so we
  // can use it for per-account baselines below).
  const chartPoints = useMemo<BalancePoint[]>(() => {
    const all = seriesQ.data?.points ?? [];
    const scoped = chartScope === 'all' ? all : all.filter((p) => p.account_id === chartScope);
    if (!rangeFromDate) return scoped;
    return scoped.filter((p) => p.bucket >= rangeFromDate);
  }, [seriesQ.data, chartScope, rangeFromDate]);

  return (
    <div className="flex flex-col gap-10">
      <DashboardHero primary={primary} />

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

      {/* Page-wide account scope — drives the balance chart, the donut and
          the Sankey. Local changes stay in this session; persistent defaults
          live in Réglages. */}
      {currencies.length > 0 && (
        <section className="surface p-4 md:p-5">
          <select
            className="input-sm w-full"
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
        </section>
      )}

      {primary && <MoyennesMensuellesSection currency={primary.currency} />}
      {primary && <InsightsSection currency={primary.currency} />}

      {/* Time series — the period picker lives here (above the graph) rather
          than in a top-of-page filter box; it still drives the donut and the
          Sankey below via the shared `range` state. */}
      {currencies.length > 0 && (
        <section className="surface p-5 md:p-6">
          <div className="section-rule mb-4 flex items-center justify-between gap-3 flex-wrap">
            <span>Évolution · {chartCurrency}</span>
            <RangePicker value={range} onChange={setRange} />
          </div>
          {seriesQ.data && primary ? (
            <BalanceChart
              points={chartPoints}
              currency={chartCurrency}
              checkpoints={chartCheckpoints}
              gapThresholdDays={settings.chartGapThresholdDays}
            />
          ) : (
            <div className="h-40 animate-pulse rounded-lg bg-ink-900" />
          )}
        </section>
      )}

      {/* Category breakdown — donut */}
      {currencies.length > 0 && (
        <section className="surface p-5 md:p-6">
          <div className="section-rule mb-4">Répartition par catégorie</div>
          <CategoryBreakdown
            range={range}
            onRangeChange={setRange}
            currency={chartCurrency}
            accountId={chartScope}
          />
        </section>
      )}

      {/* Cash-flow Sankey — follows the page range and account scope */}
      {currencies.length > 0 && (
        <SankeySection
          range={range}
          onRangeChange={setRange}
          currency={chartCurrency}
          accountId={chartScope}
        />
      )}
    </div>
  );
}
