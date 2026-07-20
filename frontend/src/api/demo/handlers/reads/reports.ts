import type { BalancePoint, BudgetPeriod, BudgetReport, BudgetReportRow, CategoryReportRow } from '../../../types';
import { getState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { bucketFor, categoryById, money, monthOf, txs } from './lib';

function handleReportsTimeseries(req: DemoRequest) {
  const state = getState();
  const granularity = (req.query.granularity as 'day' | 'week' | 'month' | undefined) ?? 'day';
  const points: BalancePoint[] = [];
  const allTx = txs();
  for (const acc of state.accounts) {
    // Group tx by bucket, sum deltas, then cumulate.
    const perBucket = new Map<string, number>();
    for (const t of allTx) {
      if (t.accountId !== acc.id) continue;
      if (t.date < acc.openingDate) continue;
      const b = bucketFor(t.date, granularity);
      perBucket.set(b, (perBucket.get(b) ?? 0) + Number(t.amount));
    }
    const buckets = Array.from(perBucket.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let cum = Number(acc.openingBalance);
    for (const [bucket, delta] of buckets) {
      cum += delta;
      points.push({
        account_id: acc.id,
        currency: acc.currency,
        bucket,
        delta: money(delta),
        cumulative: money(cum),
      });
    }
  }
  return { points };
}

function handleReportsCategories(req: DemoRequest) {
  const state = getState();
  const from = req.query.fromDate ?? req.query.from ?? '';
  const to = req.query.toDate ?? req.query.to ?? '';
  const perKey = new Map<string, { row: CategoryReportRow; total: number }>();
  for (const t of txs()) {
    if (from && t.date < from) continue;
    if (to && t.date > to) continue;
    const month = t.date.slice(0, 7);
    const catId = t.categoryId;
    const cat = categoryById(catId, state);
    const key = `${catId ?? 'null'}|${month}`;
    const row = perKey.get(key)?.row ?? {
      category_id: catId,
      category_name: cat?.name ?? null,
      category_kind: cat?.kind ?? null,
      category_is_internal_transfer: cat?.isInternalTransfer ?? null,
      month,
      total: '0.00',
      transaction_count: 0,
    };
    const bucket = perKey.get(key) ?? { row, total: 0 };
    bucket.total += Number(t.amount);
    bucket.row.transaction_count += 1;
    bucket.row.total = money(bucket.total);
    perKey.set(key, bucket);
  }
  return { rows: Array.from(perKey.values()).map((v) => v.row) };
}

function handleReportsBudget(req: DemoRequest): BudgetReport {
  const state = getState();
  const period = (req.query.period as BudgetPeriod | undefined) ?? 'monthly';
  const monthArg = req.query.month;
  const now = new Date();
  const currentMonth = monthArg ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const rows: BudgetReportRow[] = [];
  let totalLimit = 0;
  let totalSpent = 0;
  for (const b of state.budgets) {
    const cat = categoryById(b.categoryId, state);
    const spent = txs()
      .filter((t) => t.categoryId === b.categoryId && monthOf(t.date) === currentMonth)
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const limit = Number(b.monthlyLimit);
    const remaining = limit - spent;
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    totalLimit += limit;
    totalSpent += spent;
    rows.push({
      id: b.id,
      categoryId: b.categoryId,
      name: cat?.name ?? '',
      color: cat?.color ?? null,
      parentId: cat?.parentId ?? null,
      accountId: b.accountId,
      period: b.period,
      limit: money(limit),
      currency: b.currency,
      spent: money(spent),
      remaining: money(remaining),
      pct,
      over: spent > limit,
      projected: null,
      history: null,
      anomaly: false,
      suggestedLimit: null,
    });
  }
  return {
    period,
    month: currentMonth,
    windowDays: 30,
    elapsedDays: 15,
    rows,
    totals: {
      limit: money(totalLimit),
      spent: money(totalSpent),
      remaining: money(totalLimit - totalSpent),
      projected: null,
    },
    unbudgetedCandidates: [],
  };
}

export function registerReportsHandlers(): void {
  registerHandler('GET', '/api/reports/timeseries', handleReportsTimeseries);
  registerHandler('GET', '/api/reports/categories', handleReportsCategories);
  registerHandler('GET', '/api/reports/budget', handleReportsBudget);
}
