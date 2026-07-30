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
