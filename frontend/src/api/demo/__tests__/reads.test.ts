import { describe, it, expect, beforeEach } from 'vitest';
import { api, registerSeedProvider } from '../index';
import { __resetForTest } from '../store';
import { buildSeedState, SEED_META } from '../seed';
import { ApiError } from '../../apiError';

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
interface BalanceResp { perCurrency: Array<{ currency: string; total: string; available: string; invested: string; account_count: number }> }
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

  it('GET /api/auth/lock-status disarms the idle lock in demo mode', async () => {
    const r = await api<{ mode: string; lockConfigured: boolean }>('/api/auth/lock-status');
    expect(r.mode).toBe('session');
    expect(r.lockConfigured).toBe(false);
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
    expect(r.categories).toHaveLength(11);
  });

  it('GET /api/rules', async () => {
    const r = await api<{ rules: Array<{ keyword: string }> }>('/api/rules');
    expect(r.rules.map((x) => x.keyword)).toContain('carrefour');
  });

  it('GET /api/budgets', async () => {
    const r = await api<{ budgets: Array<{ monthlyLimit: string }> }>('/api/budgets');
    expect(r.budgets).toHaveLength(4);
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

  it('GET /api/accounts excludes an active lockYears lock from availableBalance', async () => {
    // Opened 2022-07-20 + 5-year lock → locked until 2027-07-20, still in the
    // future at SEED_TODAY (2026-07-18). Mirrors backend accounts/list.ts.
    await api('/api/accounts', {
      method: 'POST',
      json: { name: 'PEA', type: 'investment', currency: 'EUR', openingBalance: '5000.00', openingDate: '2022-07-20', lockYears: 5 },
    });
    const r = await api<AccountsResp>('/api/accounts');
    const pea = r.accounts.find((a) => a.name === 'PEA')!;
    expect(pea.currentBalance).toBe('5000.00');
    expect(pea.availableBalance).toBe('0.00');
  });

  it('GET /api/accounts frees the balance once the lock has expired', async () => {
    // Opened 2020-01-01 + 5-year lock → unlocked since 2025-01-01 < SEED_TODAY.
    await api('/api/accounts', {
      method: 'POST',
      json: { name: 'Vieux PEL', type: 'savings', currency: 'EUR', openingBalance: '3000.00', openingDate: '2020-01-01', lockYears: 5 },
    });
    const r = await api<AccountsResp>('/api/accounts');
    const pel = r.accounts.find((a) => a.name === 'Vieux PEL')!;
    expect(pel.availableBalance).toBe(pel.currentBalance);
  });

  it('GET /api/reports/balance: invested = available part of investment accounts only', async () => {
    // Locked PEA (blocked, so not counted as invested) + unlocked LEP
    // (investment → invested). The seeded savings account must NOT count as
    // invested. Mirrors backend reports/balance.ts.
    await api('/api/accounts', {
      method: 'POST',
      json: { name: 'PEA', type: 'investment', currency: 'EUR', openingBalance: '5000.00', openingDate: '2022-07-20', lockYears: 5 },
    });
    await api('/api/accounts', {
      method: 'POST',
      json: { name: 'LEP', type: 'investment', currency: 'EUR', openingBalance: '10000.00', openingDate: '2026-07-01' },
    });
    const r = await api<BalanceResp>('/api/reports/balance');
    const eur = r.perCurrency[0];
    expect(eur.invested).toBe('10000.00');
    // blocked (total - available) is exactly the locked PEA balance.
    expect(Number(eur.total) - Number(eur.available)).toBeCloseTo(5000, 2);
  });

  it('GET /api/settings merges app defaults over the demo seed', async () => {
    // The seed stores only demo-specific keys (locale, currency,
    // seedTodayForDemo). The handler must fill in the standard defaults the
    // way the backend does — a partial payload leaves consumers like the
    // Dashboard with dashboardChartScope === undefined, which blanks the
    // Évolution chart's account scope and empties the graph.
    const r = await api<{ settings: { dashboardChartScope: string; dashboardRange: string; locale: string } }>('/api/settings');
    expect(r.settings.dashboardChartScope).toBe('all');
    expect(r.settings.dashboardRange).toBe('3m');
    expect(r.settings.locale).toBe('fr');
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
    expect(r.rows).toHaveLength(4);
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

describe('demo reports — consolidated block (manual FX table)', () => {
  it('GET /api/reports/balance: consolidated is null when displayCurrency is unset', async () => {
    const r = await api<BalanceResp & { consolidated: unknown }>('/api/reports/balance');
    expect(r.consolidated).toBeNull();
  });

  it('GET /api/reports/balance: consolidated totals EUR-only accounts when displayCurrency = EUR', async () => {
    await api('/api/settings', { method: 'PATCH', json: { displayCurrency: 'EUR' } });
    const r = await api<BalanceResp & { consolidated: { display: string; total: string; unmapped: unknown[] } }>(
      '/api/reports/balance',
    );
    expect(r.consolidated).not.toBeNull();
    expect(r.consolidated!.display).toBe('EUR');
    expect(r.consolidated!.total).toBe(r.perCurrency[0].total);
    expect(r.consolidated!.unmapped).toEqual([]);
  });

  it('GET /api/reports/balance: consolidated.unmapped lists uncovered currencies', async () => {
    await api('/api/accounts', {
      method: 'POST',
      json: { name: 'US Checking', type: 'checking', currency: 'USD', openingBalance: '100.00', openingDate: '2026-01-01' },
    });
    await api('/api/settings', { method: 'PATCH', json: { displayCurrency: 'EUR' } });
    const r = await api<{ consolidated: { unmapped: Array<{ currency: string }> } }>('/api/reports/balance');
    expect(r.consolidated!.unmapped.map((u) => u.currency)).toContain('USD');
  });

  it('GET /api/reports/balance: consolidated.total converts once a matching rate exists', async () => {
    await api('/api/accounts', {
      method: 'POST',
      json: { name: 'US Checking', type: 'checking', currency: 'USD', openingBalance: '100.00', openingDate: '2020-01-01' },
    });
    await api('/api/fx-rates', { method: 'POST', json: { from: 'USD', to: 'EUR', effectiveFrom: '2020-01-01', rate: '0.9' } });
    await api('/api/settings', { method: 'PATCH', json: { displayCurrency: 'EUR' } });
    const r = await api<BalanceResp & { consolidated: { total: string; unmapped: unknown[] } }>('/api/reports/balance');
    expect(r.consolidated!.unmapped).toEqual([]);
    const eurTotal = Number(r.perCurrency.find((p) => p.currency === 'EUR')!.total);
    expect(Number(r.consolidated!.total)).toBeCloseTo(eurTotal + 100 * 0.9, 2);
  });

  it('GET /api/reports/timeseries: consolidated is null by default, present once displayCurrency is set', async () => {
    const before = await api<TimeseriesResp & { consolidated: unknown }>('/api/reports/timeseries');
    expect(before.consolidated).toBeNull();
    await api('/api/settings', { method: 'PATCH', json: { displayCurrency: 'EUR' } });
    const after = await api<TimeseriesResp & { consolidated: { display: string; points: unknown[] } }>(
      '/api/reports/timeseries',
    );
    expect(after.consolidated).not.toBeNull();
    expect(after.consolidated!.display).toBe('EUR');
    expect(after.consolidated!.points.length).toBeGreaterThan(0);
  });

  it('GET /api/reports/budget: consolidated is null by default, present once displayCurrency is set', async () => {
    const before = await api<BudgetReportResp & { consolidated: unknown }>('/api/reports/budget', {
      query: { month: '2026-07' },
    });
    expect(before.consolidated).toBeNull();
    await api('/api/settings', { method: 'PATCH', json: { displayCurrency: 'EUR' } });
    const after = await api<BudgetReportResp & { consolidated: { display: string; totals: { limit: string } } }>(
      '/api/reports/budget', { query: { month: '2026-07' } },
    );
    expect(after.consolidated).not.toBeNull();
    expect(after.consolidated!.display).toBe('EUR');
    expect(after.consolidated!.totals.limit).toBe(before.totals.limit);
  });

  it('GET /api/reports/balance: ?display=none overrides settings to per-currency mode', async () => {
    await api('/api/settings', { method: 'PATCH', json: { displayCurrency: 'EUR' } });
    const r = await api<{ consolidated: unknown }>('/api/reports/balance', { query: { display: 'none' } });
    expect(r.consolidated).toBeNull();
  });

  it('GET /api/reports/balance: ?display=<invalid> rejects with 400', async () => {
    let caught: unknown = null;
    try {
      await api('/api/reports/balance', { query: { display: 'xx' } });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(400);
  });

  it('GET /api/reports/budget: consolidated spent converts at the rate effective at the report period start', async () => {
    await api('/api/fx-rates', { method: 'POST', json: { from: 'USD', to: 'EUR', effectiveFrom: '2025-06-01', rate: '0.8' } });
    await api('/api/fx-rates', { method: 'POST', json: { from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9' } });
    await api('/api/settings', { method: 'PATCH', json: { displayCurrency: 'EUR' } });

    const before = await api<{ consolidated: { totals: { spent: string } } }>(
      '/api/reports/budget', { query: { month: '2026-01' } },
    );

    const cat = await api<{ category: { id: number } }>('/api/categories', {
      method: 'POST', json: { name: 'USD Test', kind: 'expense' },
    });
    await api('/api/budgets', {
      method: 'POST',
      json: { categoryId: cat.category.id, monthlyLimit: '500.00', currency: 'USD', period: 'monthly' },
    });
    await api('/api/transactions', {
      method: 'POST',
      json: { categoryId: cat.category.id, date: '2026-01-15', amount: '-100.00' },
    });

    const after = await api<{ consolidated: { totals: { spent: string } } }>(
      '/api/reports/budget', { query: { month: '2026-01' } },
    );

    const delta = Number(after.consolidated!.totals.spent) - Number(before.consolidated!.totals.spent);
    expect(delta).toBeCloseTo(100 * 0.9, 2);
  });
});
