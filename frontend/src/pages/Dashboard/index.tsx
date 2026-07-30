import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';
import type { Account, BalancePoint, BalanceCheckpoint, CategoryReportRow } from '../../api/types';
import { listCheckpoints } from '../../api/checkpoints';
import { formatAmount, amountSignClass } from '../../lib/format';
import { useSettings } from '../../lib/useSettings';
import { BalanceChart } from '../../components/BalanceChart';
import { projectAverageBalance, monthlyFlowAverages } from '../../lib/average-forecast';
import { computeMonthlyStats } from './monthly-stats';
import { AVG_WINDOW_MONTHS, monthAgoISODate, lastDayOfPrevMonthISODate } from './helpers';
import { CategoryBreakdown } from '../../components/CategoryBreakdown';
import { RangePicker, fromDateFor, type RangeKey } from '../../components/RangePicker';
import { DashboardHero } from './DashboardHero';
import { MoyennesMensuellesSection } from './MoyennesMensuellesSection';
import { InsightsSection } from './InsightsSection';
import { BudgetEnvelopeSection } from './BudgetEnvelopeSection';
import { SankeySection } from './SankeySection';
import { AccountSelect } from './AccountSelect';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { Link } from 'react-router-dom';

export function Dashboard(): JSX.Element {
  const { t } = useTranslation('dashboard');
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
  const rootErr = accountsQ.error ?? balanceQ.error;
  const rootLoading = accountsQ.isLoading || balanceQ.isLoading;
  const rootEmpty = !rootLoading && !rootErr && accounts.length === 0;

  // Truthy only once accounts have actually arrived — !rootEmpty is also
  // true while accountsQ is still loading (rootLoading gates rootEmpty),
  // which let the tour auto-start against a page whose anchors haven't
  // mounted yet on a fresh visit. Checking accounts.length directly still
  // lets the tour fire the moment the first account is created, since
  // React Query re-renders this component on cache updates.
  useAutoStartTour('dashboard', { requireData: () => accounts.length > 0 });
  const balanceAnchor = useTourAnchor('dashboard:balance');
  const curveAnchor = useTourAnchor('dashboard:curve');
  const donutAnchor = useTourAnchor('dashboard:donut');
  const insightsAnchor = useTourAnchor('dashboard:insights');
  const sankeyAnchor = useTourAnchor('dashboard:sankey');

  // Page-wide period and chart scope. Both seeded from user settings on
  // mount; in-session changes are ephemeral (no writeback). To make a
  // change stick, edit Réglages.
  const { settings, isReady, patch: patchSettings } = useSettings();
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

  // The optional forecast overlay extrapolates historical AVERAGES instead
  // of replaying confirmed recurring series — users confirm their income
  // series but few outflows, which made the old projection staircase upward
  // while the real balance stayed flat. Same query key as
  // MoyennesMensuellesSection, so React Query dedupes: tiles and projection
  // always show the same averages.
  const statsFromDate = monthAgoISODate(AVG_WINDOW_MONTHS);
  const statsToDate = lastDayOfPrevMonthISODate();
  const statsQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate: statsFromDate, toDate: statsToDate }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: { fromDate: statsFromDate, toDate: statsToDate },
      }),
    enabled: settings.showForecast,
  });

  const forecastProjection = useMemo(() => {
    if (!settings.showForecast) return undefined;
    const today = new Date().toISOString().slice(0, 10);
    // Anchor the projection to today's total for the current scope.
    let startBalance: number;
    let avgMonthlyIncome: number;
    let avgMonthlySpend: number;
    if (chartScope === 'all') {
      startBalance = Number(
        balanceQ.data?.perCurrency?.find((c) => c.currency === chartCurrency)?.total ?? 0,
      );
      const stats = computeMonthlyStats(statsQ.data?.rows ?? []);
      if (stats.monthCount === 0) return undefined;
      avgMonthlyIncome = stats.avgIncome;
      avgMonthlySpend = -stats.avgSpend; // signed → positive magnitude
    } else {
      // Single account: internal transfers move its balance, so derive the
      // averages from its own balance deltas rather than the transfer-free
      // category report. Full history — chartPoints is range-filtered.
      const acc = accounts.find((a) => a.id === chartScope);
      startBalance = Number(acc?.currentBalance ?? acc?.openingBalance ?? 0);
      const scoped = (seriesQ.data?.points ?? []).filter((p) => p.account_id === chartScope);
      const flows = monthlyFlowAverages(scoped, today);
      if (!flows) return undefined;
      avgMonthlyIncome = flows.avgIncome;
      avgMonthlySpend = flows.avgSpend;
    }
    // Cap at 180 days ahead so the overlay stays bounded regardless of
    // how the range picker was set.
    const HORIZON = 180;
    // Drop index 0 (today) — the historical line already ends there.
    return projectAverageBalance({
      startBalance,
      avgMonthlyIncome,
      avgMonthlySpend,
      horizonDays: HORIZON,
      startDate: today,
    }).slice(1);
  }, [settings.showForecast, statsQ.data, seriesQ.data, chartScope, chartCurrency, accounts, balanceQ.data]);

  return (
    <div className="flex flex-col gap-10">
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">{t('title')}</h1>
            <TourReplayIcon pageId="dashboard" />
          </div>
        </div>
      </div>

      {rootErr && (
        <ErrorState
          title={t('error.title')}
          error={rootErr}
          onRetry={() => {
            void accountsQ.refetch();
            void balanceQ.refetch();
            void seriesQ.refetch();
          }}
        />
      )}

      {rootEmpty && (
        <EmptyState
          title={t('empty.title')}
          hint={t('empty.hint')}
          action={
            <Link to="/accounts" className="btn-primary text-sm">
              {t('empty.cta')}
            </Link>
          }
        />
      )}

      {!rootErr && !rootEmpty && (
        <div className="relative">
          <span
            ref={balanceAnchor}
            aria-hidden
            className="pointer-events-none absolute right-4 top-4 h-1 w-1"
          />
          <DashboardHero primary={primary} />
        </div>
      )}

      {/* Sections below are hidden while the root queries are erroring or empty
          — no point showing a wall of skeletons behind a top-level error. */}
      {!rootErr && !rootEmpty && currencies.length > 1 && (
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

      {!rootErr && !rootEmpty && primary && <MoyennesMensuellesSection currency={primary.currency} />}
      {!rootErr && !rootEmpty && primary && (
        <div className="relative">
          <span
            ref={insightsAnchor}
            aria-hidden
            className="pointer-events-none absolute right-4 top-4 h-1 w-1"
          />
          <InsightsSection currency={primary.currency} />
        </div>
      )}
      {!rootErr && !rootEmpty && <BudgetEnvelopeSection />}

      {/* Time series — the account scope and period picker sit in the card
          header (right-aligned). Both drive the donut and the Sankey below
          via the shared `range` / `chartScope` state, and each chart card
          mirrors the same control cluster for visibility. Persistent
          defaults live in Réglages; in-session changes are ephemeral. */}
      {!rootErr && !rootEmpty && currencies.length > 0 && (
        <section className="surface p-5 md:p-6 relative">
          <span
            ref={curveAnchor}
            aria-hidden
            className="pointer-events-none absolute right-4 top-4 h-1 w-1"
          />
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">{t('sections.evolution', { currency: chartCurrency })}</span>
            <div className="flex-1 h-px bg-ink-800" />
            <div className="flex items-center gap-2 flex-wrap">
              <label
                className="flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer select-none"
                title={t('forecast.tooltip')}
              >
                <input
                  type="checkbox"
                  checked={settings.showForecast}
                  onChange={(e) => patchSettings({ showForecast: e.target.checked })}
                  className="accent-sage-500"
                />
                {t('forecast.label')}
              </label>
              <AccountSelect
                value={chartScope}
                onChange={setChartScope}
                accounts={accounts}
                primaryCurrency={primary?.currency}
              />
              <RangePicker value={range} onChange={setRange} />
            </div>
          </div>
          {seriesQ.isError ? (
            <ErrorState variant="inline" error={seriesQ.error} onRetry={() => void seriesQ.refetch()} />
          ) : seriesQ.data && primary ? (
            <BalanceChart
              points={chartPoints}
              currency={chartCurrency}
              checkpoints={chartCheckpoints}
              gapThresholdDays={settings.chartGapThresholdDays}
              projection={forecastProjection}
            />
          ) : (
            <LoadingBlock variant="inline" height="min-h-40" />
          )}
        </section>
      )}

      {/* Category breakdown — donut */}
      {!rootErr && !rootEmpty && currencies.length > 0 && (
        <section className="surface p-5 md:p-6 relative">
          <span
            ref={donutAnchor}
            aria-hidden
            className="pointer-events-none absolute right-4 top-4 h-1 w-1"
          />
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">{t('sections.categoryBreakdown')}</span>
            <div className="flex-1 h-px bg-ink-800" />
            <div className="flex items-center gap-2 flex-wrap">
              <AccountSelect
                value={chartScope}
                onChange={setChartScope}
                accounts={accounts}
                primaryCurrency={primary?.currency}
              />
              <RangePicker value={range} onChange={setRange} />
            </div>
          </div>
          <CategoryBreakdown
            range={range}
            onRangeChange={setRange}
            currency={chartCurrency}
            accountId={chartScope}
          />
        </section>
      )}

      {/* Cash-flow Sankey — follows the page range and account scope */}
      {!rootErr && !rootEmpty && currencies.length > 0 && (
        <div className="relative">
          <span
            ref={sankeyAnchor}
            aria-hidden
            className="pointer-events-none absolute right-4 top-4 h-1 w-1"
          />
          <SankeySection
            range={range}
            onRangeChange={setRange}
            currency={chartCurrency}
            accountId={chartScope}
            accounts={accounts}
            onAccountChange={setChartScope}
            primaryCurrency={primary?.currency}
          />
        </div>
      )}
    </div>
  );
}
