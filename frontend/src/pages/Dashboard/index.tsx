import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { SectionTip } from '../../components/SectionTip';
import { SectionTipHelpIcon } from '../../components/SectionTipHelpIcon';
import type { Account, BalancePoint, BalanceCheckpoint } from '../../api/types';
import { listCheckpoints } from '../../api/checkpoints';
import { formatAmount, amountSignClass } from '../../lib/format';
import { useSettings } from '../../lib/useSettings';
import { BalanceChart } from '../../components/BalanceChart';
import { projectBalance } from '../../lib/recurring-forecast';
import type { RecurringSeries } from '../../api/types';
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

  // Recurring series drive the optional forecast overlay on the Trend
  // chart. Query is unconditional but its result is only consumed when
  // `settings.showForecast` is on — invalidations across the app already
  // cascade to this cache.
  const recurringQ = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api<{ recurring: RecurringSeries[] }>('/api/recurring'),
    enabled: settings.showForecast,
  });

  const forecastProjection = useMemo(() => {
    if (!settings.showForecast) return undefined;
    const rows = recurringQ.data?.recurring ?? [];
    if (rows.length === 0) return undefined;
    // Anchor the projection to today's total for the current scope.
    let startBalance = 0;
    const balanceCurrency = chartCurrency;
    if (chartScope === 'all') {
      startBalance = Number(
        balanceQ.data?.perCurrency?.find((c) => c.currency === balanceCurrency)?.total ?? 0,
      );
    } else {
      const acc = accounts.find((a) => a.id === chartScope);
      startBalance = Number(acc?.currentBalance ?? acc?.openingBalance ?? 0);
    }
    const today = new Date().toISOString().slice(0, 10);
    // Cap at 180 days ahead so the overlay stays bounded regardless of
    // how the range picker was set.
    const HORIZON = 180;
    const forecast = projectBalance({
      startBalance,
      series: rows,
      horizonDays: HORIZON,
      startDate: today,
    });
    // Drop index 0 (today) — the historical line already ends there.
    return forecast.slice(1).map((p) => ({ date: p.date, value: p.projectedBalance }));
  }, [settings.showForecast, recurringQ.data, chartScope, chartCurrency, accounts, balanceQ.data]);

  return (
    <div className="flex flex-col gap-10">
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">{t('title')}</h1>
            <SectionTipHelpIcon id="section:dashboard" />
          </div>
        </div>
      </div>
      <SectionTip id="section:dashboard" />

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

      {!rootErr && !rootEmpty && <DashboardHero primary={primary} />}

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
      {!rootErr && !rootEmpty && primary && <InsightsSection currency={primary.currency} />}
      {!rootErr && !rootEmpty && <BudgetEnvelopeSection />}

      {/* Time series — the account scope and period picker sit in the card
          header (right-aligned). Both drive the donut and the Sankey below
          via the shared `range` / `chartScope` state, and each chart card
          mirrors the same control cluster for visibility. Persistent
          defaults live in Réglages; in-session changes are ephemeral. */}
      {!rootErr && !rootEmpty && currencies.length > 0 && (
        <section className="surface p-5 md:p-6">
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">{t('sections.evolution', { currency: chartCurrency })}</span>
            <div className="flex-1 h-px bg-ink-800" />
            <div className="flex items-center gap-2 flex-wrap">
              <label
                className="flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer select-none"
                title="Prolonge la courbe avec une projection en pointillé basée sur les séries récurrentes actives."
              >
                <input
                  type="checkbox"
                  checked={settings.showForecast}
                  onChange={(e) => patchSettings({ showForecast: e.target.checked })}
                  className="accent-sage-500"
                />
                Voir la projection
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
        <section className="surface p-5 md:p-6">
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
        <SankeySection
          range={range}
          onRangeChange={setRange}
          currency={chartCurrency}
          accountId={chartScope}
          accounts={accounts}
          onAccountChange={setChartScope}
          primaryCurrency={primary?.currency}
        />
      )}
    </div>
  );
}
