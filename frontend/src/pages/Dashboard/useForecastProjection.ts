import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account, BalancePoint, CategoryReportRow } from '../../api/types';
import {
  projectAverageBalance,
  monthlyFlowAverages,
  type AverageProjectionPoint,
} from '../../lib/average-forecast';
import { computeMonthlyStats } from './monthly-stats';
import { AVG_WINDOW_MONTHS, monthAgoISODate, lastDayOfPrevMonthISODate } from './helpers';

export interface ForecastProjection {
  points: AverageProjectionPoint[];
  // Authoritative "as of today" balance for the current scope. Fed to
  // BalanceChart's alignEndTo so the historical endpoint and the projection
  // start at the same value — the join stays continuous.
  anchor: number;
}

interface Input {
  enabled: boolean;
  chartScope: 'all' | number;
  chartCurrency: string;
  accounts: Account[];
  perCurrency: Array<{ currency: string; total: string }> | undefined;
  points: BalancePoint[] | undefined;
}

// The optional forecast overlay extrapolates historical AVERAGES instead
// of replaying confirmed recurring series — users confirm their income
// series but few outflows, which made the old projection staircase upward
// while the real balance stayed flat. Same query key as
// MoyennesMensuellesSection, so React Query dedupes: tiles and projection
// always show the same averages.
export function useForecastProjection({
  enabled,
  chartScope,
  chartCurrency,
  accounts,
  perCurrency,
  points,
}: Input): ForecastProjection | undefined {
  const statsFromDate = monthAgoISODate(AVG_WINDOW_MONTHS);
  const statsToDate = lastDayOfPrevMonthISODate();
  const statsQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate: statsFromDate, toDate: statsToDate }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: { fromDate: statsFromDate, toDate: statsToDate },
      }),
    enabled,
  });

  return useMemo(() => {
    if (!enabled) return undefined;
    const today = new Date().toISOString().slice(0, 10);
    // Anchor the projection to today's total for the current scope.
    let startBalance: number;
    let avgMonthlyIncome: number;
    let avgMonthlySpend: number;
    if (chartScope === 'all') {
      startBalance = Number(perCurrency?.find((c) => c.currency === chartCurrency)?.total ?? 0);
      const stats = computeMonthlyStats(statsQ.data?.rows ?? []);
      if (stats.monthCount === 0) return undefined;
      avgMonthlyIncome = stats.avgIncome;
      avgMonthlySpend = -stats.avgSpend; // signed → positive magnitude
    } else {
      // Single account: internal transfers move its balance, so derive the
      // averages from its own balance deltas rather than the transfer-free
      // category report. Full history — the chart's points are range-filtered.
      const acc = accounts.find((a) => a.id === chartScope);
      startBalance = Number(acc?.currentBalance ?? acc?.openingBalance ?? 0);
      const scoped = (points ?? []).filter((p) => p.account_id === chartScope);
      const flows = monthlyFlowAverages(scoped, today);
      if (!flows) return undefined;
      avgMonthlyIncome = flows.avgIncome;
      avgMonthlySpend = flows.avgSpend;
    }
    // Cap at 180 days ahead so the overlay stays bounded regardless of
    // how the range picker was set.
    const HORIZON = 180;
    // Drop index 0 (today) — the historical line already ends there.
    const projPoints = projectAverageBalance({
      startBalance,
      avgMonthlyIncome,
      avgMonthlySpend,
      horizonDays: HORIZON,
      startDate: today,
    }).slice(1);
    return { points: projPoints, anchor: startBalance };
  }, [enabled, statsQ.data, points, chartScope, chartCurrency, accounts, perCurrency]);
}
