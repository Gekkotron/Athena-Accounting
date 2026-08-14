import type { BalancePoint, BudgetPeriod, BudgetReport, BudgetReportRow, CategoryReportRow } from '../../../types';
import { getState, type DemoFxRate } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { ApiError } from '../../../apiError';
import { aggregateTimeseriesByBucket, consolidate, resolveRate } from '../../../../lib/fx';
import { bucketFor, categoryById, money, monthOf, resolveDisplayCurrency, settingsDisplayCurrency, txs } from './lib';

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

  const displayParam = req.query.display;
  const settingsDisplay = displayParam === undefined ? settingsDisplayCurrency(state) : null;
  const resolved = resolveDisplayCurrency(displayParam, settingsDisplay);
  if (resolved === 'invalid') {
    throw new ApiError('invalid display currency', 400, { error: 'invalid display currency' });
  }

  let consolidated: { display: string; points: ReturnType<typeof aggregateTimeseriesByBucket> } | null = null;
  if (resolved !== null) {
    consolidated = { display: resolved, points: aggregateTimeseriesByBucket(points, resolved, state.fxRates ?? []) };
  }

  return { points, consolidated };
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
    // Mirror the backend's EFFECTIVE internal-transfer flag: a child
    // inherits its parent's is_internal_transfer (hierarchy is 2 levels).
    const parent = cat?.parentId != null ? categoryById(cat.parentId, state) : null;
    const key = `${catId ?? 'null'}|${month}`;
    const row = perKey.get(key)?.row ?? {
      category_id: catId,
      category_name: cat?.name ?? null,
      category_kind: cat?.kind ?? null,
      category_is_internal_transfer: cat
        ? cat.isInternalTransfer || (parent?.isInternalTransfer ?? false)
        : null,
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

const BUDGET_CONSOLIDATE_KEYS = ['limit', 'spent', 'remaining'] as const;

// Half-up rounding to 2 decimals, matching frontend/src/lib/fx.ts's own copy.
function quantize2(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

type BudgetConsolidateRow = { currency: string; limit: string; spent: string; remaining: string; projected: string | null };

// Mirrors backend/src/http/routes/reports/budget.ts's buildBudgetConsolidatedBlock.
// Demo budget rows never carry a `projected` value (see handleReportsBudget
// below), so `projected` here always resolves to null — the formula is kept
// intact anyway so a future demo forecast doesn't silently diverge from the
// backend's math.
function buildBudgetConsolidated(rows: BudgetConsolidateRow[], display: string, rates: DemoFxRate[], at: string) {
  type PerCurrencyAgg = { currency: string; limit: string; spent: string; remaining: string; projected: number | null };

  const byCurrency = new Map<string, { limit: number; spent: number; remaining: number; projected: number | null }>();
  for (const r of rows) {
    let g = byCurrency.get(r.currency);
    if (!g) {
      g = { limit: 0, spent: 0, remaining: 0, projected: 0 };
      byCurrency.set(r.currency, g);
    }
    g.limit += Number(r.limit);
    g.spent += Number(r.spent);
    g.remaining += Number(r.remaining);
    if (g.projected !== null) {
      if (r.projected == null) g.projected = null;
      else g.projected += Number(r.projected);
    }
  }

  const perCurrency: PerCurrencyAgg[] = Array.from(byCurrency.entries()).map(([currency, g]) => ({
    currency,
    limit: g.limit.toFixed(2),
    spent: g.spent.toFixed(2),
    remaining: g.remaining.toFixed(2),
    projected: g.projected,
  }));

  const out = consolidate(perCurrency, display, rates, at, BUDGET_CONSOLIDATE_KEYS);
  const unmappedRows = out.unmapped as PerCurrencyAgg[];

  const anyNullProjected = perCurrency.some((p) => p.projected == null);
  let projectedTotal: string | null = null;
  if (unmappedRows.length === 0 && !anyNullProjected) {
    let sum = 0;
    for (const p of perCurrency) {
      const rate = resolveRate(rates, p.currency, display, at);
      sum += (p.projected as number) * (rate as number);
    }
    projectedTotal = quantize2(sum);
  }

  return {
    display: out.display,
    totals: {
      limit: out.totals.limit,
      spent: out.totals.spent,
      remaining: out.totals.remaining,
      projected: projectedTotal,
    },
    unmapped: unmappedRows.map((u) => ({
      currency: u.currency,
      limit: u.limit,
      spent: u.spent,
      remaining: u.remaining,
      projected: u.projected == null ? null : u.projected.toFixed(2),
    })),
  };
}

function handleReportsBudget(req: DemoRequest): BudgetReport & { consolidated: ReturnType<typeof buildBudgetConsolidated> | null } {
  const state = getState();
  const period = (req.query.period as BudgetPeriod | undefined) ?? 'monthly';
  const monthArg = req.query.month;
  const now = new Date();
  const currentMonth = monthArg ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const rows: BudgetReportRow[] = [];
  const consolidationRows: BudgetConsolidateRow[] = [];
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
    consolidationRows.push({
      currency: b.currency,
      limit: money(limit),
      spent: money(spent),
      remaining: money(remaining),
      projected: null,
    });
  }

  const displayParam = req.query.display;
  const settingsDisplay = displayParam === undefined ? settingsDisplayCurrency(state) : null;
  const resolved = resolveDisplayCurrency(displayParam, settingsDisplay);
  if (resolved === 'invalid') {
    throw new ApiError('invalid display currency', 400, { error: 'invalid display currency' });
  }

  let consolidated: ReturnType<typeof buildBudgetConsolidated> | null = null;
  if (resolved !== null) {
    // Mirrors backend/src/http/routes/reports/budget.ts's use of startIso.
    const startIso = `${currentMonth}-01`;
    consolidated = buildBudgetConsolidated(consolidationRows, resolved, state.fxRates ?? [], startIso);
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
    consolidated,
    unbudgetedCandidates: [],
  };
}

export function registerReportsHandlers(): void {
  registerHandler('GET', '/api/reports/timeseries', handleReportsTimeseries);
  registerHandler('GET', '/api/reports/categories', handleReportsCategories);
  registerHandler('GET', '/api/reports/budget', handleReportsBudget);
}
