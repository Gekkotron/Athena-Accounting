// GET handlers for the browser-only demo. Each is a pure function of
// the current store state. Response shapes mirror what the backend
// returns — the frontend can't tell it's talking to a fake.

import type {
  Account,
  BalancePoint,
  Budget,
  BudgetPeriod,
  BudgetReport,
  BudgetReportRow,
  Category,
  CategoryReportRow,
  Rule,
  Transaction,
  TransferRule,
  TriGroup,
} from '../../types';
import { getState, type DemoState } from '../store';
import { registerHandler, type DemoRequest } from '../index';

// Amounts are stored as fixed-point strings; conversion to Number for
// aggregation is safe within the demo's small dataset. When emitting a
// numeric string back out we go through toFixed(2) so shapes stay
// canonical.
const money = (n: number): string => (n < 0 ? '-' : '') + Math.abs(n).toFixed(2);

function txs(): Transaction[] {
  return getState().transactions as unknown as Transaction[];
}

function categoryById(id: number | null | undefined, state: DemoState): Category | null {
  if (id == null) return null;
  return state.categories.find((c) => c.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Auth + onboarding + health
// ---------------------------------------------------------------------------

function handleAuthMe() {
  return { user: { id: 1, username: 'Démo' } };
}

function handleOnboardingStatus() {
  return { needsOnboarding: false };
}

function handleHealth() {
  return { ok: true, mode: 'demo' as const };
}

// ---------------------------------------------------------------------------
// Accounts — enriched with computed balances + counts
// ---------------------------------------------------------------------------

function enrichAccount(acc: Account, allTx: Transaction[]): Account {
  const opening = Number(acc.openingBalance);
  const mine = allTx.filter((t) => t.accountId === acc.id);
  const counted = mine.filter((t) => t.date >= acc.openingDate);
  const currentBalance = counted.reduce((s, t) => s + Number(t.amount), opening);
  return {
    ...acc,
    currentBalance: money(currentBalance),
    transactionCount: mine.length,
    countedTransactionCount: counted.length,
    availableBalance: money(currentBalance),
  };
}

function handleAccounts() {
  const state = getState();
  const allTx = txs();
  return { accounts: state.accounts.map((a) => enrichAccount(a, allTx)) };
}

// ---------------------------------------------------------------------------
// Simple list endpoints
// ---------------------------------------------------------------------------

function handleCategories() {
  return { categories: getState().categories as Category[] };
}

function handleRules() {
  return { rules: getState().rules as Rule[] };
}

function handleTransferRules() {
  return { transferRules: getState().transferRules as TransferRule[] };
}

function handleBudgets() {
  return { budgets: getState().budgets as Budget[] };
}

function handleSettings() {
  return { settings: getState().settings };
}

// ---------------------------------------------------------------------------
// Transactions — filter + paginate + optional runningBalance
// ---------------------------------------------------------------------------

interface TxFilters {
  accountId?: number;
  from?: string;
  to?: string;
  q?: string;
  categoryId?: number | null;
  uncategorized?: boolean;
}

function parseTxFilters(q: Record<string, string>): { filters: TxFilters; limit: number; offset: number } {
  const filters: TxFilters = {};
  if (q.accountId) filters.accountId = Number(q.accountId);
  if (q.from) filters.from = q.from;
  if (q.to) filters.to = q.to;
  if (q.q) filters.q = q.q.toLowerCase();
  if (q.categoryId === 'null' || q.uncategorized === 'true') filters.uncategorized = true;
  else if (q.categoryId) filters.categoryId = Number(q.categoryId);
  const limit = q.limit ? Math.max(1, Math.min(500, Number(q.limit))) : 50;
  const offset = q.offset ? Math.max(0, Number(q.offset)) : 0;
  return { filters, limit, offset };
}

function applyTxFilters(list: Transaction[], f: TxFilters): Transaction[] {
  return list.filter((t) => {
    if (f.accountId != null && t.accountId !== f.accountId) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.uncategorized && t.categoryId != null) return false;
    if (f.categoryId != null && t.categoryId !== f.categoryId) return false;
    if (f.q && !t.rawLabel.toLowerCase().includes(f.q) && !t.normalizedLabel.includes(f.q)) return false;
    return true;
  });
}

function attachRunningBalance(list: Transaction[], accountId: number, state: DemoState): Transaction[] {
  const acc = state.accounts.find((a) => a.id === accountId);
  if (!acc) return list;
  const chrono = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let running = Number(acc.openingBalance);
  const rbById = new Map<number, string>();
  for (const t of chrono) {
    if (t.date < acc.openingDate) continue;
    running += Number(t.amount);
    rbById.set(t.id, money(running));
  }
  return list.map((t) => (rbById.has(t.id) ? { ...t, runningBalance: rbById.get(t.id)! } : t));
}

function handleTransactions(req: DemoRequest) {
  const state = getState();
  const { filters, limit, offset } = parseTxFilters(req.query);
  const all = applyTxFilters(txs(), filters);
  const chrono = [...all].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const page = chrono.slice(offset, offset + limit);
  const enriched = filters.accountId != null ? attachRunningBalance(page, filters.accountId, state) : page;
  return {
    transactions: enriched,
    pagination: { total: all.length, limit, offset },
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function handleReportsBalance() {
  const state = getState();
  const allTx = txs();
  const enriched = state.accounts.map((a) => enrichAccount(a, allTx));
  const byCurrency = new Map<string, { currency: string; total: number; available: number; invested: number; account_count: number }>();
  for (const a of enriched) {
    const cur = a.currency;
    const bucket = byCurrency.get(cur) ?? { currency: cur, total: 0, available: 0, invested: 0, account_count: 0 };
    bucket.total += Number(a.currentBalance ?? 0);
    bucket.available += Number(a.availableBalance ?? 0);
    if (a.type === 'savings' || a.type === 'investment') {
      bucket.invested += Number(a.currentBalance ?? 0);
    }
    bucket.account_count += 1;
    byCurrency.set(cur, bucket);
  }
  return {
    perCurrency: Array.from(byCurrency.values()).map((b) => ({
      currency: b.currency,
      total: money(b.total),
      available: money(b.available),
      invested: money(b.invested),
      account_count: b.account_count,
    })),
  };
}

function bucketFor(date: string, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return date.slice(0, 7);
  // week: use ISO week-ish grouping via YYYY-Www — cheap enough here.
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dt.getUTCDay() || 7; // Sun=7
  dt.setUTCDate(dt.getUTCDate() - (dayOfWeek - 1));
  const iso = dt.toISOString().slice(0, 10);
  return iso;
}

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

function monthOf(date: string): string {
  return date.slice(0, 7);
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

// ---------------------------------------------------------------------------
// Tri (uncategorised buckets)
// ---------------------------------------------------------------------------

function handleTriGroups(req: DemoRequest) {
  const limit = req.query.limit ? Number(req.query.limit) : 200;
  const offset = req.query.offset ? Number(req.query.offset) : 0;
  const perNorm = new Map<string, {
    normalized_label: string;
    transaction_count: number;
    total: number;
    example_raw_label: string;
    example_id: number;
    min_date: string;
    max_date: string;
  }>();
  for (const t of txs()) {
    if (t.categoryId != null) continue;
    const key = t.normalizedLabel || t.rawLabel.toLowerCase();
    const entry = perNorm.get(key) ?? {
      normalized_label: key,
      transaction_count: 0,
      total: 0,
      example_raw_label: t.rawLabel,
      example_id: t.id,
      min_date: t.date,
      max_date: t.date,
    };
    entry.transaction_count += 1;
    entry.total += Number(t.amount);
    if (t.date < entry.min_date) entry.min_date = t.date;
    if (t.date > entry.max_date) entry.max_date = t.date;
    perNorm.set(key, entry);
  }
  const all: TriGroup[] = Array.from(perNorm.values())
    .sort((a, b) => b.transaction_count - a.transaction_count)
    .map((v) => ({
      normalized_label: v.normalized_label,
      transaction_count: v.transaction_count,
      total_amount: money(v.total),
      example_raw_label: v.example_raw_label,
      example_id: v.example_id,
      min_date: v.min_date,
      max_date: v.max_date,
    }));
  return {
    groups: all.slice(offset, offset + limit),
    pagination: { total: all.length, limit, offset },
  };
}

// ---------------------------------------------------------------------------
// Balance checkpoints — per-account list
// ---------------------------------------------------------------------------

function handleAccountCheckpoints(req: DemoRequest) {
  const accountId = Number(req.query.accountId);
  const state = getState();
  const checkpoints = (state.balanceCheckpoints as Array<{ accountId: number }>).filter(
    (c) => c.accountId === accountId,
  );
  return { checkpoints };
}

// ---------------------------------------------------------------------------
// Recurring series — Récurrent page
// ---------------------------------------------------------------------------

// Add `daysCount` days to an ISO YYYY-MM-DD, UTC-safe.
function addDaysIso(iso: string, daysCount: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + daysCount * 86_400_000;
  const dt = new Date(t);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function todayIso(): string {
  // Demo mode uses the seeded SEED_TODAY when present so upcoming/forecast
  // views render with the same anchor the transaction seed uses.
  const state = getState();
  const s = state.settings as { seedTodayForDemo?: string };
  return s.seedTodayForDemo ?? new Date().toISOString().slice(0, 10);
}

// Recompute next_due_at at read time when ?upcoming=N is set. Walks
// forward from last_seen_at in cadence-day steps until the next date is
// strictly ≥ today. Mirrors the backend logic in routes/recurring.ts.
function nextDueFrom(lastSeen: string, cadenceDays: number, today: string): string {
  let next = lastSeen;
  // Guard against infinite loops on bad data.
  for (let i = 0; i < 5000; i++) {
    if (next >= today) return next;
    next = addDaysIso(next, cadenceDays);
  }
  return next;
}

function handleRecurring(req: DemoRequest) {
  const state = getState();
  const rows = state.recurring ?? [];
  const upcomingRaw = req.query.upcoming;

  if (upcomingRaw !== undefined && upcomingRaw !== '') {
    const raw = Number(upcomingRaw);
    if (!Number.isFinite(raw) || raw <= 0) return { recurring: [] };
    const horizon = Math.min(180, Math.floor(raw));
    const today = todayIso();
    const cutoff = addDaysIso(today, horizon);
    const withNext = rows.map((r) => ({
      ...r,
      nextDueAt: nextDueFrom(r.lastSeenAt, r.cadenceDays, today),
    }));
    const filtered = withNext.filter((r) => r.nextDueAt <= cutoff);
    filtered.sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt));
    return { recurring: filtered };
  }

  // Default: ordered by ABS(monthly-equivalent) desc, matching the backend.
  const sorted = [...rows].sort((a, b) => {
    const eqA = Math.abs(Number(a.avgAmount) * (30 / a.cadenceDays));
    const eqB = Math.abs(Number(b.avgAmount) * (30 / b.cadenceDays));
    return eqB - eqA;
  });
  return { recurring: sorted };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function registerReadHandlers(): void {
  registerHandler('GET', '/api/auth/me', handleAuthMe);
  registerHandler('GET', '/api/onboarding/status', handleOnboardingStatus);
  registerHandler('GET', '/health', handleHealth);
  registerHandler('GET', '/api/accounts', handleAccounts);
  registerHandler('GET', '/api/categories', handleCategories);
  registerHandler('GET', '/api/rules', handleRules);
  registerHandler('GET', '/api/transfer-rules', handleTransferRules);
  registerHandler('GET', '/api/budgets', handleBudgets);
  registerHandler('GET', '/api/settings', handleSettings);
  registerHandler('GET', '/api/transactions', handleTransactions);
  registerHandler('GET', '/api/reports/balance', handleReportsBalance);
  registerHandler('GET', '/api/reports/timeseries', handleReportsTimeseries);
  registerHandler('GET', '/api/reports/categories', handleReportsCategories);
  registerHandler('GET', '/api/reports/budget', handleReportsBudget);
  registerHandler('GET', '/api/tri/groups', handleTriGroups);
  registerHandler('GET', '/api/accounts/:accountId/balance-checkpoints', handleAccountCheckpoints);
  registerHandler('GET', '/api/recurring', handleRecurring);
}
