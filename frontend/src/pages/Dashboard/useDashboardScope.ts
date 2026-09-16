import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Account, BalanceCheckpoint, BalancePoint, TimeseriesConsolidatedBlock } from '../../api/types';
import { listCheckpoints } from '../../api/checkpoints';
import type { Settings } from '../../lib/settings';
import { fromDateFor, type RangeKey } from '../../components/RangePicker';
import { withCarriedBaselines } from '../../components/BalanceChart/series';
import { isAccountAvailable, filterToAvailableOverTime } from './helpers';

// Dashboard's page-wide scope state (period + account) plus every
// downstream chart derivation. Split out of Dashboard/index.tsx so the
// scope logic — hydration guard, "available" resolution, chart-point
// filtering, consolidated-series suppression — lives in one testable
// place instead of being tangled with the JSX layout.
export function useDashboardScope(args: {
  accounts: Account[];
  settings: Settings;
  isReady: boolean;
  seriesData: { points: BalancePoint[]; consolidated: TimeseriesConsolidatedBlock | null } | undefined;
  perCurrencyCount: number;
  primaryCurrency: string | undefined;
}) {
  const { accounts, settings, isReady, seriesData, perCurrencyCount, primaryCurrency } = args;

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

  // Resolve the 'available' scope into a concrete set of account ids for
  // the donut and Sankey (as an accountIds param). Matches the hero's
  // Disponible definition: unlocked AND non-investment.
  const availableAccountIds = useMemo(() => {
    const now = new Date();
    return accounts
      .filter((a) => a.type !== 'investment' && isAccountAvailable(a, now))
      .map((a) => a.id);
  }, [accounts]);
  const nonInvestmentAccounts = useMemo(
    () => accounts.filter((a) => a.type !== 'investment'),
    [accounts],
  );
  const hasAnyLocked = nonInvestmentAccounts.length > 0
    && availableAccountIds.length < nonInvestmentAccounts.length;
  const hasAnyInvestment = accounts.some((a) => a.type === 'investment');
  // Guard against a persisted 'available' pick becoming meaningless — with
  // no locked accounts AND no investment accounts, the 'available' subset
  // equals the full set, so fall back to 'all'.
  const effectiveScope: 'all' | 'available' | number =
    chartScope === 'available' && !hasAnyLocked && !hasAnyInvestment
      ? 'all'
      : chartScope;

  // Checkpoints for the currently scoped account. Skipped entirely when
  // scope is 'all' or 'available' — checkpoints are per-account by design.
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
      return primaryCurrency ?? 'EUR';
    }
    const acc = accounts.find((a) => a.id === effectiveScope);
    return acc?.currency ?? primaryCurrency ?? 'EUR';
  }, [effectiveScope, accounts, primaryCurrency]);

  // Only feed the chart points matching the chosen scope. Range window is
  // applied client-side via withCarriedBaselines so accounts that were
  // quiet inside the window still contribute (a plain bucket filter
  // dropped them, sagging the curve by their whole balance).
  const chartPoints = useMemo<BalancePoint[]>(() => {
    const all = seriesData?.points ?? [];
    let scoped: BalancePoint[];
    if (effectiveScope === 'all') {
      scoped = all;
    } else if (effectiveScope === 'available') {
      scoped = filterToAvailableOverTime(all, accounts);
    } else {
      scoped = all.filter((p) => p.account_id === effectiveScope);
    }
    return withCarriedBaselines(scoped, rangeFromDate);
  }, [seriesData, effectiveScope, accounts, rangeFromDate]);

  // The consolidated block aggregates ALL accounts server-side — only
  // valid when the chart itself is scoped to 'all'. Also suppressed when
  // the user only has one currency: nothing to FX-consolidate, and the
  // server's consolidated line for a 1-currency pot doesn't match the
  // client-side per-account sum (missing quiet-account carry, no pre-
  // window baseline).
  const chartConsolidated = effectiveScope === 'all' && perCurrencyCount > 1
    ? seriesData?.consolidated ?? null
    : null;
  const chartUsesConsolidated = chartConsolidated !== null;

  return {
    range, setRange,
    chartScope, setChartScope,
    effectiveScope,
    availableAccountIds,
    hasAnyLocked, hasAnyInvestment,
    chartCheckpoints, chartCurrency, chartPoints,
    chartConsolidated, chartUsesConsolidated,
  };
}
