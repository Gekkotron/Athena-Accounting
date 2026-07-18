import { describe, it, expect, beforeEach } from 'vitest';
import { api, registerSeedProvider } from '../index';
import { __resetForTest } from '../store';
import { buildSeedState, SEED_META } from '../seed';

// Match the runtime shapes the frontend expects. Anything asserted here
// is a contract the demo adapter must never silently break.

interface AuthMe { user: { id: number; username: string } }
interface AccountsResp { accounts: Array<{
  id: number; name: string; currency: string; currentBalance?: string;
  transactionCount?: number; countedTransactionCount?: number; availableBalance?: string;
}> }
interface TxResp { transactions: Array<{
  id: number; accountId: number; date: string; amount: string;
  categoryId: number | null; runningBalance?: string;
}>; pagination: { total: number; limit: number; offset: number } }
interface BalanceResp { perCurrency: Array<{ currency: string; total: string; account_count: number }> }
interface TimeseriesResp { points: Array<{ account_id: number; currency: string; bucket: string; delta: string; cumulative: string }> }
interface CategoriesReportResp { rows: Array<{ category_id: number | null; month: string; total: string; transaction_count: number }> }
interface BudgetReportResp { rows: Array<{ id: number; categoryId: number; spent: string; remaining: string; over: boolean }>; totals: { limit: string; spent: string } }
interface TriResp { groups: Array<{ normalized_label: string; transaction_count: number }>; pagination: { total: number } }
interface CheckpointsResp { checkpoints: Array<{ id: number; accountId: number; checkpointDate: string; expectedAmount: string }> }

beforeEach(() => {
  __resetForTest();
  registerSeedProvider(buildSeedState);
});

describe('demo read handlers', () => {
  it('GET /api/auth/me returns the demo user', async () => {
    const r = await api<AuthMe>('/api/auth/me');
    expect(r.user.username).toBe('Démo');
  });

  it('GET /api/onboarding/status', async () => {
    const r = await api<{ needsOnboarding: boolean }>('/api/onboarding/status');
    expect(r.needsOnboarding).toBe(false);
  });

  it('GET /health', async () => {
    const r = await api<{ ok: boolean; mode: string }>('/health');
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('demo');
  });

  it('GET /api/accounts enriches with computed fields', async () => {
    const r = await api<AccountsResp>('/api/accounts');
    expect(r.accounts).toHaveLength(2);
    const courant = r.accounts.find((a) => a.id === SEED_META.accountIds.Courant)!;
    expect(courant.currentBalance).toMatch(/^-?\d+\.\d{2}$/);
    expect(courant.transactionCount).toBeGreaterThan(0);
    expect(courant.availableBalance).toBe(courant.currentBalance);
  });

  it('GET /api/categories', async () => {
    const r = await api<{ categories: unknown[] }>('/api/categories');
    expect(r.categories).toHaveLength(8);
  });

  it('GET /api/rules', async () => {
    const r = await api<{ rules: Array<{ keyword: string }> }>('/api/rules');
    expect(r.rules.map((x) => x.keyword)).toContain('carrefour');
  });

  it('GET /api/budgets', async () => {
    const r = await api<{ budgets: Array<{ monthlyLimit: string }> }>('/api/budgets');
    expect(r.budgets).toHaveLength(3);
  });

  it('GET /api/transactions paginates', async () => {
    const p1 = await api<TxResp>('/api/transactions', { query: { limit: 10, offset: 0 } });
    expect(p1.transactions).toHaveLength(10);
    expect(p1.pagination.limit).toBe(10);
    expect(p1.pagination.offset).toBe(0);
    expect(p1.pagination.total).toBeGreaterThan(150);
  });

  it('GET /api/transactions with accountId adds runningBalance', async () => {
    const r = await api<TxResp>('/api/transactions', {
      query: { accountId: SEED_META.accountIds.Courant, limit: 5 },
    });
    expect(r.transactions.every((t) => t.runningBalance !== undefined)).toBe(true);
  });

  it('GET /api/transactions filters by q + date range', async () => {
    const r = await api<TxResp>('/api/transactions', {
      query: { q: 'carrefour', from: '2026-05-01', to: '2026-05-31', limit: 200 },
    });
    expect(r.transactions.length).toBeGreaterThan(0);
    expect(r.transactions.every((t) => t.date >= '2026-05-01' && t.date <= '2026-05-31')).toBe(true);
  });

  it('GET /api/reports/balance aggregates per currency', async () => {
    const r = await api<BalanceResp>('/api/reports/balance');
    expect(r.perCurrency).toHaveLength(1);
    expect(r.perCurrency[0].currency).toBe('EUR');
    expect(r.perCurrency[0].account_count).toBe(2);
  });

  it('GET /api/reports/timeseries', async () => {
    const r = await api<TimeseriesResp>('/api/reports/timeseries', { query: { granularity: 'day' } });
    expect(r.points.length).toBeGreaterThan(0);
    expect(r.points.every((p) => p.bucket.match(/^\d{4}-\d{2}-\d{2}$/))).toBe(true);
    expect(r.points.every((p) => p.currency === 'EUR')).toBe(true);
  });

  it('GET /api/reports/categories groups by (category, month)', async () => {
    const r = await api<CategoriesReportResp>('/api/reports/categories', {
      query: { from: '2026-05-01', to: '2026-07-31' },
    });
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((row) => row.month.match(/^\d{4}-\d{2}$/))).toBe(true);
  });

  it('GET /api/reports/budget returns per-budget rows', async () => {
    const r = await api<BudgetReportResp>('/api/reports/budget', { query: { month: '2026-07' } });
    expect(r.rows).toHaveLength(3);
    expect(r.totals.limit).toMatch(/^\d+\.\d{2}$/);
  });

  it('GET /api/tri/groups returns uncategorised buckets', async () => {
    const r = await api<TriResp>('/api/tri/groups', { query: { limit: 50, offset: 0 } });
    expect(r.groups.length).toBeGreaterThan(0);
    expect(r.groups.every((g) => g.transaction_count > 0)).toBe(true);
  });

  it('GET /api/accounts/:accountId/balance-checkpoints', async () => {
    const r = await api<CheckpointsResp>(`/api/accounts/${SEED_META.accountIds.Courant}/balance-checkpoints`);
    expect(r.checkpoints).toHaveLength(1);
    expect(r.checkpoints[0].accountId).toBe(SEED_META.accountIds.Courant);
  });

  it('checkpoint expected amount matches computed balance at checkpoint date', async () => {
    const r = await api<CheckpointsResp>(`/api/accounts/${SEED_META.accountIds.Courant}/balance-checkpoints`);
    const cp = r.checkpoints[0];
    // Re-derive balance at that date via the transactions endpoint.
    const tx = await api<TxResp>('/api/transactions', {
      query: { accountId: cp.accountId, to: cp.checkpointDate, limit: 500 },
    });
    const last = tx.transactions[0];
    expect(last).toBeDefined();
    // Newest first with runningBalance on it. Its runningBalance is the
    // cumulative sum at that date — must match the checkpoint.
    expect(Number(last.runningBalance!)).toBeCloseTo(Number(cp.expectedAmount), 2);
  });
});
