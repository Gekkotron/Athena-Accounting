import type { CategoryReportRow } from '../../api/types';

export interface MonthlyStats {
  monthCount: number;
  avgSpend: number; // signed (≤ 0)
  avgIncome: number;
  avgSavings: number;
}

// Shared by the Moyennes mensuelles tiles and the Trend chart's projection
// overlay — one computation so the two can never display different averages.
export function computeMonthlyStats(rows: CategoryReportRow[]): MonthlyStats {
  // Aggregate signed totals per month using the SIGN of the amount
  // (backend already excludes rows where transfer_group_id IS NOT NULL).
  // We also skip rows whose category is flagged `is_internal_transfer` so
  // users who don't rely on the auto mirror-leg detector — and instead tag
  // one side of a self-transfer with a dedicated category (e.g. "Épargne")
  // — get honest averages. Skipped from BOTH buckets so avgSavings stays
  // consistent (revenue − expenses cancels out on both legs).
  const monthly = new Map<string, { spend: number; income: number }>();
  for (const r of rows) {
    if (r.category_is_internal_transfer) continue;
    const cur = monthly.get(r.month) ?? { spend: 0, income: 0 };
    const amount = Number(r.total);
    if (!Number.isFinite(amount)) continue;
    if (amount < 0) cur.spend += amount;
    else if (amount > 0) cur.income += amount;
    monthly.set(r.month, cur);
  }
  // Guard against /0 when there is no history yet.
  const monthCount = monthly.size || 1;
  let totalSpend = 0;
  let totalIncome = 0;
  for (const v of monthly.values()) {
    totalSpend += v.spend;
    totalIncome += v.income;
  }
  return {
    monthCount: monthly.size,
    avgSpend: totalSpend / monthCount,
    avgIncome: totalIncome / monthCount,
    avgSavings: (totalIncome + totalSpend) / monthCount,
  };
}
