// Pure balance projection driven by historical monthly averages. No React,
// no fetch — the Dashboard Trend chart overlay plugs the output into
// BalanceChart's `projection` prop. Unlike lib/recurring-forecast.ts (which
// replays confirmed recurring series and therefore ignores everything the
// user never confirmed), this extrapolates the observed averages, so the
// projected slope always matches the historical trend.

export interface AverageProjectionPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface ProjectAverageBalanceOptions {
  startBalance: number;
  avgMonthlyIncome: number; // positive €/month
  avgMonthlySpend: number; // positive magnitude €/month
  horizonDays: number;
  startDate: string; // YYYY-MM-DD — emitted as index 0, untouched
}

// UTC-safe ISO day arithmetic — matches recurring-forecast + UpcomingTab.
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function daysInMonthOf(iso: string): number {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Sawtooth: +avgMonthlyIncome lands on the 1st of each projected month (the
// "salary day"), while avgMonthlySpend drains as a daily drift sized to that
// month's length. Net change over any full month = income − spend = average
// savings, so the projection's trend matches history by construction.
export function projectAverageBalance(opts: ProjectAverageBalanceOptions): AverageProjectionPoint[] {
  const { startBalance, avgMonthlyIncome, avgMonthlySpend, horizonDays, startDate } = opts;
  if (horizonDays <= 0) return [];

  const out: AverageProjectionPoint[] = [{ date: startDate, value: startBalance }];
  let running = startBalance;
  for (let i = 1; i <= horizonDays; i++) {
    const date = addDaysIso(startDate, i);
    if (date.endsWith('-01')) running += avgMonthlyIncome;
    running -= avgMonthlySpend / daysInMonthOf(date);
    out.push({ date, value: running });
  }
  return out;
}

export interface MonthlyFlowAverages {
  monthCount: number;
  avgIncome: number; // positive €/month
  avgSpend: number; // positive magnitude €/month
}

// Average monthly inflow/outflow of a SINGLE account, derived from its
// balance-timeseries deltas. Used for the projection when the chart is
// scoped to one account: internal transfers DO move that account's balance,
// so the category-based averages (which exclude transfers) would lie here.
// Exclusions: the month of the first bucket (the backend folds the opening
// balance into it) and the current month (half-finished). Months absent
// from the data don't count — same behavior as the Moyennes tiles.
export function monthlyFlowAverages(
  points: Array<{ bucket: string; delta: string }>,
  todayIso: string,
  maxMonths = 12,
): MonthlyFlowAverages | null {
  if (points.length === 0) return null;
  let firstMonth = points[0]!.bucket.slice(0, 7);
  for (const p of points) {
    const m = p.bucket.slice(0, 7);
    if (m < firstMonth) firstMonth = m;
  }
  const currentMonth = todayIso.slice(0, 7);

  const monthly = new Map<string, { income: number; spend: number }>();
  for (const p of points) {
    const month = p.bucket.slice(0, 7);
    if (month <= firstMonth || month >= currentMonth) continue;
    const delta = Number(p.delta);
    if (!Number.isFinite(delta)) continue;
    const cur = monthly.get(month) ?? { income: 0, spend: 0 };
    if (delta > 0) cur.income += delta;
    else cur.spend += -delta;
    monthly.set(month, cur);
  }

  const months = [...monthly.keys()].sort().slice(-maxMonths);
  if (months.length === 0) return null;
  let income = 0;
  let spend = 0;
  for (const m of months) {
    const v = monthly.get(m)!;
    income += v.income;
    spend += v.spend;
  }
  return {
    monthCount: months.length,
    avgIncome: income / months.length,
    avgSpend: spend / months.length,
  };
}
