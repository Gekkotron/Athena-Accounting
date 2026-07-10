import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../Dashboard';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
vi.mock('../../api/checkpoints', () => ({
  listCheckpoints: vi.fn(async () => ({ checkpoints: [] })),
}));
// The chart uses SVG size heuristics that don't render in jsdom; stub it out
// to a plain <div> to keep the test focused on the surrounding orchestration.
vi.mock('../../components/BalanceChart', () => ({
  BalanceChart: ({ currency }: { currency: string }) => <div data-testid="chart">chart:{currency}</div>,
}));
vi.mock('../../components/CategoryBreakdown', () => ({
  CategoryBreakdown: () => <div data-testid="breakdown">breakdown</div>,
}));

import { api } from '../../api/client';
const apiMock = vi.mocked(api);

const acc = (id: number, name: string, overrides: any = {}) => ({
  id, name, type: 'checking', currency: 'EUR',
  openingBalance: '0', openingDate: '2025-01-01',
  currentBalance: '100', availableBalance: '100',
  transactionCount: 5, countedTransactionCount: 5,
  ...overrides,
});

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  localStorage.clear();
});

describe('Dashboard', () => {
  it('renders the "Solde net" hero when nothing is blocked', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 'all',
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
        },
      };
      if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
      if (path === '/api/reports/balance') return {
        perCurrency: [{ currency: 'EUR', total: '100.00', available: '100.00', account_count: 1 }],
      };
      if (path === '/api/reports/timeseries') return { points: [] };
      throw new Error(`unexpected: ${path}`);
    });
    renderDashboard();
    // Hero switches its content once the balance query resolves. Wait for
    // the async "somme" label to guarantee data has arrived.
    expect(await screen.findByText('somme')).toBeInTheDocument();
    expect(screen.getByText('Solde net')).toBeInTheDocument();
  });

  it('switches the hero label to "Disponible" + adds a "bloqués" tag when a lock is active', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 'all',
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
        },
      };
      if (path === '/api/accounts') return { accounts: [acc(1, 'PEA', { lockYears: 5, availableBalance: '0' })] };
      if (path === '/api/reports/balance') return {
        perCurrency: [{ currency: 'EUR', total: '10000.00', available: '4000.00', account_count: 1 }],
      };
      if (path === '/api/reports/timeseries') return { points: [] };
      throw new Error(`unexpected: ${path}`);
    });
    renderDashboard();
    expect(await screen.findByText('Disponible')).toBeInTheDocument();
    // The hero renders a "bloqués" tag when a lock is active.
    expect(screen.getAllByText(/bloqués/i).length).toBeGreaterThan(0);
  });

  it('reads dashboardChartScope from /api/settings on mount', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 2,
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
        },
      };
      if (path === '/api/accounts') return { accounts: [acc(1, 'A'), acc(2, 'B')] };
      if (path === '/api/reports/balance') return {
        perCurrency: [{ currency: 'EUR', total: '100.00', available: '100.00', account_count: 2 }],
      };
      if (path === '/api/reports/timeseries') return { points: [] };
      throw new Error(`unexpected: ${path}`);
    });
    renderDashboard();
    const select = await screen.findByLabelText(/compte affiché/i);
    // Wait for settings to hydrate.
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('2'));
  });

  it('local changes to the chart selector do NOT PATCH /api/settings', async () => {
    const patchCalls: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (init?.method === 'PATCH') { patchCalls.push({ path, init }); return { settings: {} }; }
      if (path === '/api/settings') return {
        settings: {
          dashboardRange: '3m', dashboardChartScope: 'all',
          chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
        },
      };
      if (path === '/api/accounts') return { accounts: [acc(1, 'A'), acc(2, 'B')] };
      if (path === '/api/reports/balance') return {
        perCurrency: [{ currency: 'EUR', total: '100.00', available: '100.00', account_count: 2 }],
      };
      if (path === '/api/reports/timeseries') return { points: [] };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderDashboard();
    const select = await screen.findByLabelText(/compte affiché/i);
    await u.selectOptions(select, '2');
    // Give any accidental PATCH time to fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(patchCalls).toHaveLength(0);
  });

});
