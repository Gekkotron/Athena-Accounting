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
import { todayLocalIso } from '../../lib/dates';
import { AVG_WINDOW_MONTHS, monthAgoISODate, lastDayOfPrevMonthISODate } from './helpers';

export interface ForecastProjection {
  points: AverageProjectionPoint[];
  // Authoritative "as of today" balance for the current scope. Fed to
  // BalanceChart's alignEndTo so the historical endpoint and the projection
  // start at the same value — the join stays continuous.
  anchor: number;
  // How many complete historical months the projection averaged over. The
  // Recurrent › Prévisions tab surfaces this in a caption so users can tell
  // a wobbly one-month projection from a stable twelve-month one.
  monthCount: number;
}

interface Input {
  enabled: boolean;
  chartScope: 'all' | 'available' | number;
  chartCurrency: string;
  accounts: Account[];
  perCurrency: Array<{ currency: string; total: string }> | undefined;
  points: BalancePoint[] | undefined;
  // Optional horizon override (days). Defaults to 180 so the Dashboard's
  // Trend overlay stays bounded regardless of the range picker; the
  // Recurrent › Prévisions tab drives this from its horizon picker.
  horizonDays?: number;
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
  horizonDays,
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
    // Forecast is disabled for the 'available' scope: computing an average
    // from a subset of accounts requires per-account cash-flow separation
    // that the category report doesn't give us, and reusing the 'all'
    // averages would misrepresent the projection. The historical curve
    // still renders — only the dashed forward line is suppressed.
    if (chartScope === 'available') return undefined;
    const today = todayLocalIso();
    // Anchor the projection to today's total for the current scope.
    let startBalance: number;
    let avgMonthlyIncome: number;
    let avgMonthlySpend: number;
    let monthCount: number;
    if (chartScope === 'all') {
      startBalance = Number(perCurrency?.find((c) => c.currency === chartCurrency)?.total ?? 0);
      const stats = computeMonthlyStats(statsQ.data?.rows ?? []);
      if (stats.monthCount === 0) return undefined;
      avgMonthlyIncome = stats.avgIncome;
      avgMonthlySpend = -stats.avgSpend; // signed → positive magnitude
      monthCount = stats.monthCount;
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
      monthCount = flows.monthCount;
    }
    // Drop index 0 (today) — the historical line already ends there.
    const projPoints = projectAverageBalance({
      startBalance,
      avgMonthlyIncome,
      avgMonthlySpend,
      horizonDays: horizonDays ?? 180,
      startDate: today,
    }).slice(1);
    return { points: projPoints, anchor: startBalance, monthCount };
  }, [enabled, statsQ.data, points, chartScope, chartCurrency, accounts, perCurrency, horizonDays]);
}
