import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../Dashboard';
import { withTips } from '../../test/renderWithProviders';
import { pinLocale } from '../../test/i18n';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
vi.mock('../../api/checkpoints', () => ({
  listCheckpoints: vi.fn(async () => ({ checkpoints: [] })),
}));
vi.mock('../../components/BalanceChart', () => ({
  BalanceChart: () => <div data-testid="chart">chart</div>,
}));
vi.mock('../../components/CategoryBreakdown', () => ({
  CategoryBreakdown: () => <div data-testid="breakdown">breakdown</div>,
}));

import { api } from '../../api/client';
const apiMock = vi.mocked(api);

const acc = (id: number, type: string) => ({
  id, name: `Compte ${id}`, type, currency: 'EUR',
  openingBalance: '0', openingDate: '2025-01-01',
  currentBalance: '100', availableBalance: '100',
  transactionCount: 5, countedTransactionCount: 5,
});

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{withTips(<Dashboard />)}</MemoryRouter>
    </QueryClientProvider>,
  );
}

pinLocale('dashboard', 'charts', 'tips');

// Mimics the settings round-trip: a PATCH merges into the server copy that
// later GETs return, so the optimistic update and refetch agree.
function mockApi(accounts: ReturnType<typeof acc>[]) {
  const settings: Record<string, unknown> = {
    dashboardRange: '3m', dashboardChartScope: 'all',
    chartGapThresholdDays: 6, duplicateSimilarityThreshold: 0,
    displayCurrency: 'EUR', showUnrealizedGains: false,
  };
  apiMock.mockImplementation(async (path: string, opts?: { method?: string; json?: unknown }) => {
    if (path === '/api/settings') {
      if (opts?.method === 'PATCH') Object.assign(settings, opts.json);
      return { settings: { ...settings } };
    }
    if (path === '/api/accounts') return { accounts };
    if (path === '/api/reports/balance') return {
      perCurrency: [{ currency: 'EUR', total: '100.00', available: '100.00', invested: '0.00', account_count: accounts.length }],
    };
    if (path === '/api/reports/timeseries') return { points: [], consolidated: null };
    throw new Error(`unexpected: ${path}`);
  });
}

const timeseriesQueries = () =>
  apiMock.mock.calls
    .filter(([p]) => p === '/api/reports/timeseries')
    .map(([, o]) => (o as { query?: Record<string, unknown> } | undefined)?.query ?? {});

beforeEach(() => {
  apiMock.mockReset();
  localStorage.clear();
});

describe('Dashboard unrealized-gains toggle', () => {
  it('is hidden without an investment account', async () => {
    mockApi([acc(1, 'checking')]);
    renderDashboard();
    await screen.findByTestId('chart');
    expect(screen.getByLabelText(/voir la projection/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/plus-values latentes/i)).not.toBeInTheDocument();
  });

  it('patches the setting and re-requests the timeseries with withGains=1', async () => {
    mockApi([acc(1, 'checking'), acc(2, 'investment')]);
    renderDashboard();
    const box = await screen.findByLabelText(/plus-values latentes/i);
    await waitFor(() => expect(timeseriesQueries().length).toBeGreaterThan(0));
    expect(timeseriesQueries().every((q) => q.withGains === undefined)).toBe(true);
    await userEvent.click(box);
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({
        method: 'PATCH', json: expect.objectContaining({ showUnrealizedGains: true }),
      }));
      expect(timeseriesQueries().some((q) => q.withGains === 1)).toBe(true);
    });
  });
});
