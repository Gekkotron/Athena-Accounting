import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';
import type { Account, BalancePoint, BalanceCheckpoint, TimeseriesConsolidatedBlock } from '../../api/types';
import { listCheckpoints } from '../../api/checkpoints';
import { useSettings } from '../../lib/useSettings';
import { BalanceChart } from '../../components/BalanceChart';
import { withCarriedBaselines } from '../../components/BalanceChart/series';
import { useForecastProjection } from './useForecastProjection';
import { CategoryBreakdown } from '../../components/CategoryBreakdown';
import { RangePicker, fromDateFor, type RangeKey } from '../../components/RangePicker';
import { DashboardHero } from './DashboardHero';
import { BalanceCardBlock, type ConsolidatedBlock, type PerCurrencyRow } from './BalanceCardBlock';
import { MoyennesMensuellesSection } from './MoyennesMensuellesSection';
import { InsightsSection } from './InsightsSection';
import { BudgetEnvelopeSection } from './BudgetEnvelopeSection';
import { SankeySection } from './SankeySection';
import { SavingsGoalsSection } from './SavingsGoalsSection';
import { AccountSelect } from './AccountSelect';
import { isAccountAvailable, filterToAvailableOverTime } from './helpers';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { Link } from 'react-router-dom';

export function Dashboard(): JSX.Element {
  const { t } = useTranslation('dashboard');
  // Hoisted above the queries below so the timeseries query can key on and
  // send the user's display currency (Settings → Multi-devises).
  const { settings, isReady, patch: patchSettings } = useSettings();
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const balanceQ = useQuery({
    queryKey: ['reports', 'balance', settings.displayCurrency],
    queryFn: () => api<{ perCurrency: PerCurrencyRow[]; consolidated: ConsolidatedBlock | null }>('/api/reports/balance', {
      query: { ...(settings.displayCurrency ? { display: settings.displayCurrency } : {}) },
    }),
  });
  const seriesQ = useQuery({
    queryKey: ['reports', 'timeseries', settings.displayCurrency],
    queryFn: () => api<{ points: BalancePoint[]; consolidated: TimeseriesConsolidatedBlock | null }>('/api/reports/timeseries', {
      query: { granularity: 'day', ...(settings.displayCurrency ? { display: settings.displayCurrency } : {}) },
    }),
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
  const [range, setRange] = useState<RangeKey>(settings.dashboardRange);
  const [chartScope, setChartScope] = useState<'all' | 'available' | number>(settings.dashboardChartScope);
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

  // Resolve the 'available' scope into a concrete set of account ids. This
  // set is the source of truth for every chart: the balance chart filters
  // its points against it, the donut and Sankey send it as an accountIds
  // param. Memoised over accounts so the identity is stable across renders.
  const availableAccountIds = useMemo(() => {
    const now = new Date();
    return accounts.filter((a) => isAccountAvailable(a, now)).map((a) => a.id);
  }, [accounts]);
  const hasAnyLocked = accounts.length > 0 && availableAccountIds.length < accounts.length;
  // Guard against a persisted 'available' pick becoming invalid once every
  // account is unlocked — treat it as 'all' so the chart doesn't quietly go
  // empty (an unlocked-only set equals the full set anyway).
  const effectiveScope: 'all' | 'available' | number = chartScope === 'available' && !hasAnyLocked
    ? 'all'
    : chartScope;

  // Checkpoints for the currently scoped account. Skipped entirely when scope
  // is 'all' or 'available' — checkpoints are per-account by design.
  const checkpointsQ = useQuery({
    queryKey: ['balance-checkpoints', effectiveScope],
    queryFn: () => listCheckpoints(effectiveScope as number),
    enabled: typeof effectiveScope === 'number',
  });

  const chartCheckpoints = useMemo(() => {
    if (typeof effectiveScope !== 'number') return undefined;
    const raw = checkpointsQ.data?.checkpoints ?? [];
    return raw.map((c: BalanceCheckpoint) => ({
      date: c.checkpointDate,
      expectedAmount: Number(c.expectedAmount),
      note: c.note ?? undefined,
    }));
  }, [checkpointsQ.data, effectiveScope]);

  const chartCurrency = useMemo(() => {
    if (effectiveScope === 'all' || effectiveScope === 'available') {
      return primary?.currency ?? 'EUR';
    }
    const acc = accounts.find((a) => a.id === effectiveScope);
    return acc?.currency ?? primary?.currency ?? 'EUR';
  }, [effectiveScope, accounts, primary]);

  // Only feed the chart points matching the chosen scope. BalanceChart already
  // filters by currency on top of this, so cross-currency rows are dropped too.
  // Range window applied client-side (backend returns the whole series so we
  // can use it for per-account baselines below). withCarriedBaselines keeps
  // accounts that were quiet inside the window in the aggregate — a plain
  // bucket filter dropped them, sagging the curve by their whole balance.
  const chartPoints = useMemo<BalancePoint[]>(() => {
    const all = seriesQ.data?.points ?? [];
    let scoped: BalancePoint[];
    if (effectiveScope === 'all') {
      scoped = all;
    } else if (effectiveScope === 'available') {
      // "As money unlocks, the curve steps up": every account contributes,
      // but a locked account only starts contributing on its unlock date
      // (see filterToAvailableOverTime). withCarriedBaselines still runs
      // afterward for the range-window clip — its lastBefore map is
      // populated from post-unlock points only, so a locked account whose
      // unlock lies before rangeFromDate is carried in like any other.
      scoped = filterToAvailableOverTime(all, accounts);
    } else {
      scoped = all.filter((p) => p.account_id === effectiveScope);
    }
    return withCarriedBaselines(scoped, rangeFromDate);
  }, [seriesQ.data, effectiveScope, accounts, rangeFromDate]);

  // Average-based forecast overlay for the Trend chart — see
  // useForecastProjection for the rationale and the per-scope math.
  const forecastProjection = useForecastProjection({
    enabled: settings.showForecast,
    chartScope: effectiveScope,
    chartCurrency,
    accounts,
    perCurrency: balanceQ.data?.perCurrency,
    points: seriesQ.data?.points,
  });

  // The consolidated block aggregates ALL accounts server-side — only valid
  // when the chart itself is scoped to 'all'. A single-account scope keeps
  // the raw per-currency curve. Also suppressed when the user only has one
  // currency: there's nothing to FX-consolidate, and the server's
  // consolidated line for a 1-currency pot doesn't match the client-side
  // per-account sum (missing quiet-account carry, no pre-window baseline),
  // which reads as "the curve looks like just the primary account".
  const chartConsolidated = effectiveScope === 'all' && currencies.length > 1
    ? seriesQ.data?.consolidated ?? null
    : null;
  // The forecast overlay's anchor/points are computed from raw single-currency
  // balances (see useForecastProjection), while the consolidated series is
  // FX-converted into `chartConsolidated.display`. Mixing the two would shift
  // the historical curve by a bogus amount (mergeHistoricalAndProjection's
  // `alignEndTo` assumes both magnitudes share a currency) — so the forecast
  // overlay is suppressed whenever the chart is showing the consolidated
  // series. Cross-currency forecast support is out of scope for now.
  const chartUsesConsolidated = chartConsolidated !== null;

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
      {!rootErr && !rootEmpty && (
        <BalanceCardBlock currencies={currencies} consolidated={balanceQ.data?.consolidated ?? null} />
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
      {!rootErr && !rootEmpty && <SavingsGoalsSection />}

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
                value={effectiveScope}
                onChange={setChartScope}
                accounts={accounts}
                primaryCurrency={primary?.currency}
                hideAvailable={!hasAnyLocked}
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
              consolidated={chartConsolidated}
              checkpoints={chartCheckpoints}
              gapThresholdDays={settings.chartGapThresholdDays}
              projection={chartUsesConsolidated ? undefined : forecastProjection?.points}
              alignEndTo={chartUsesConsolidated ? undefined : forecastProjection?.anchor}
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
                value={effectiveScope}
                onChange={setChartScope}
                accounts={accounts}
                primaryCurrency={primary?.currency}
                hideAvailable={!hasAnyLocked}
              />
              <RangePicker value={range} onChange={setRange} />
            </div>
          </div>
          <CategoryBreakdown
            range={range}
            onRangeChange={setRange}
            currency={chartCurrency}
            accountId={typeof effectiveScope === 'number' ? effectiveScope : 'all'}
            accountIds={effectiveScope === 'available' ? availableAccountIds : undefined}
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
            accountId={effectiveScope}
            accountIds={effectiveScope === 'available' ? availableAccountIds : undefined}
            accounts={accounts}
            onAccountChange={setChartScope}
            primaryCurrency={primary?.currency}
            hideAvailableInSelect={!hasAnyLocked}
          />
        </div>
      )}
    </div>
  );
}
