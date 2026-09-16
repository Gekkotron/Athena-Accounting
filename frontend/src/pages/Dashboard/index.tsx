import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAutoStartTour } from '../../hooks/useAutoStartTour';
import { useTourAnchor } from '../../hooks/useTourAnchor';
import { TourReplayIcon } from '../../components/TourReplayIcon';
import type { BalancePoint, TimeseriesConsolidatedBlock } from '../../api/types';
import { useSettings } from '../../lib/useSettings';
import { useAccounts } from '../../lib/useReferenceData';
import { BalanceChart } from '../../components/BalanceChart';
import { useForecastProjection } from './useForecastProjection';
import { CategoryBreakdown } from '../../components/CategoryBreakdown';
import { DashboardHero } from './DashboardHero';
import { BalanceCardBlock, type ConsolidatedBlock, type PerCurrencyRow } from './BalanceCardBlock';
import { MoyennesMensuellesSection } from './MoyennesMensuellesSection';
import { InsightsSection } from './InsightsSection';
import { BudgetEnvelopeSection } from './BudgetEnvelopeSection';
import { SankeySection } from './SankeySection';
import { SavingsGoalsSection } from './SavingsGoalsSection';
import { ScopeControls } from './ScopeControls';
import { useDashboardScope } from './useDashboardScope';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { Link } from 'react-router-dom';

export function Dashboard(): JSX.Element {
  const { t } = useTranslation('dashboard');
  // Hoisted above the queries below so the timeseries query can key on and
  // send the user's display currency (Settings → Multi-devises).
  const { settings, isReady, patch: patchSettings } = useSettings();
  const accountsQ = useAccounts();
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
  const accounts = accountsQ.data ?? [];
  const primary = currencies[0];
  const rootErr = accountsQ.error ?? balanceQ.error;
  const rootLoading = accountsQ.isLoading || balanceQ.isLoading;
  const rootEmpty = !rootLoading && !rootErr && accounts.length === 0;

  // Truthy only once accounts have actually arrived — !rootEmpty is also
  // true while accountsQ is still loading (rootLoading gates rootEmpty),
  // which let the tour auto-start against a page whose anchors haven't
  // mounted yet on a fresh visit.
  useAutoStartTour('dashboard', { requireData: () => accounts.length > 0 });
  const balanceAnchor = useTourAnchor('dashboard:balance');
  const curveAnchor = useTourAnchor('dashboard:curve');
  const donutAnchor = useTourAnchor('dashboard:donut');
  const insightsAnchor = useTourAnchor('dashboard:insights');
  const sankeyAnchor = useTourAnchor('dashboard:sankey');

  const {
    range, setRange, setChartScope, effectiveScope,
    availableAccountIds, hasAnyLocked, hasAnyInvestment,
    chartCheckpoints, chartCurrency, chartPoints,
    chartConsolidated, chartUsesConsolidated,
  } = useDashboardScope({
    accounts, settings, isReady,
    seriesData: seriesQ.data,
    perCurrencyCount: currencies.length,
    primaryCurrency: primary?.currency,
  });

  // Average-based forecast overlay for the Trend chart — see
  // useForecastProjection for the rationale and the per-scope math. The
  // overlay is suppressed whenever the chart is showing the consolidated
  // (FX-converted) series (cross-currency forecast is out of scope).
  const forecastProjection = useForecastProjection({
    enabled: settings.showForecast,
    chartScope: effectiveScope,
    chartCurrency,
    accounts,
    perCurrency: balanceQ.data?.perCurrency,
    points: seriesQ.data?.points,
  });

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
          action={<Link to="/accounts" className="btn-primary text-sm">{t('empty.cta')}</Link>}
        />
      )}

      {!rootErr && !rootEmpty && (
        <div className="relative">
          <span ref={balanceAnchor} aria-hidden className="pointer-events-none absolute right-4 top-4 h-1 w-1" />
          <DashboardHero primary={primary} />
        </div>
      )}

      {/* Sections below are hidden while the root queries are erroring or
          empty — no point showing a wall of skeletons behind a top-level
          error. */}
      {!rootErr && !rootEmpty && (
        <BalanceCardBlock currencies={currencies} consolidated={balanceQ.data?.consolidated ?? null} />
      )}

      {!rootErr && !rootEmpty && primary && <MoyennesMensuellesSection currency={primary.currency} />}
      {!rootErr && !rootEmpty && primary && (
        <div className="relative">
          <span ref={insightsAnchor} aria-hidden className="pointer-events-none absolute right-4 top-4 h-1 w-1" />
          <InsightsSection currency={primary.currency} />
        </div>
      )}
      {!rootErr && !rootEmpty && <BudgetEnvelopeSection />}
      {!rootErr && !rootEmpty && <SavingsGoalsSection />}

      {/* Time series — the account scope and period picker sit in the card
          header (right-aligned). Both drive the donut and the Sankey below
          via the shared `range` / `chartScope` state. */}
      {!rootErr && !rootEmpty && currencies.length > 0 && (
        <section className="surface p-5 md:p-6 relative">
          <span ref={curveAnchor} aria-hidden className="pointer-events-none absolute right-4 top-4 h-1 w-1" />
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">{t('sections.evolution', { currency: chartCurrency })}</span>
            <div className="flex-1 h-px bg-ink-800" />
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer select-none" title={t('forecast.tooltip')}>
                <input type="checkbox" checked={settings.showForecast} onChange={(e) => patchSettings({ showForecast: e.target.checked })} className="accent-sage-500" />
                {t('forecast.label')}
              </label>
              <ScopeControls
                value={effectiveScope} onValueChange={setChartScope}
                accounts={accounts} primaryCurrency={primary?.currency}
                hideAvailable={!hasAnyLocked && !hasAnyInvestment}
                range={range} onRangeChange={setRange}
              />
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
          <span ref={donutAnchor} aria-hidden className="pointer-events-none absolute right-4 top-4 h-1 w-1" />
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">{t('sections.categoryBreakdown')}</span>
            <div className="flex-1 h-px bg-ink-800" />
            <div className="flex items-center gap-2 flex-wrap">
              <ScopeControls
                value={effectiveScope} onValueChange={setChartScope}
                accounts={accounts} primaryCurrency={primary?.currency}
                hideAvailable={!hasAnyLocked && !hasAnyInvestment}
                range={range} onRangeChange={setRange}
              />
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
          <span ref={sankeyAnchor} aria-hidden className="pointer-events-none absolute right-4 top-4 h-1 w-1" />
          <SankeySection
            range={range}
            onRangeChange={setRange}
            currency={chartCurrency}
            accountId={effectiveScope}
            accountIds={effectiveScope === 'available' ? availableAccountIds : undefined}
            accounts={accounts}
            onAccountChange={setChartScope}
            primaryCurrency={primary?.currency}
            hideAvailableInSelect={!hasAnyLocked && !hasAnyInvestment}
          />
        </div>
      )}
    </div>
  );
}
