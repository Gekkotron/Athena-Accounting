import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ForecastTab } from '../ForecastTab';
import { withTips } from '../../../test/renderWithProviders';
import { pinLocale } from '../../../test/i18n';
import type { Account, BalancePoint, CategoryReportRow } from '../../../api/types';

vi.mock('../../../api/client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';

// Replace the heavy SVG chart with a marker so the tests can assert the
// chart branch was chosen without exercising the chart itself.
vi.mock('../../../components/BalanceChart', () => ({
  BalanceChart: () => <div data-testid="balance-chart" />,
}));

// AccountSelect (rendered inside ForecastTab) uses the 'dashboard' namespace;
// preload it here so the tab doesn't suspend on first render.
pinLocale('tips', 'dashboard');

const account = (over: Partial<Account>): Account => ({
  id: 1,
  name: 'Compte',
  type: 'checking',
  currency: 'EUR',
  openingBalance: '0.00',
  openingDate: '2026-01-01',
  currentBalance: '1000.00',
  ...over,
});

const row = (over: Partial<CategoryReportRow>): CategoryReportRow => ({
  category_id: 1,
  category_name: 'X',
  category_kind: 'expense',
  category_is_internal_transfer: false,
  month: '2026-06',
  total: '-100.00',
  transaction_count: 1,
  ...over,
});

// Two complete months of income + spend → the average window has 2 samples.
const historyRows: CategoryReportRow[] = [
  row({ month: '2026-06', total: '2000.00', category_id: 100, category_name: 'Salaire' }),
  row({ month: '2026-06', total: '-500.00', category_id: 200, category_name: 'Loyer' }),
  row({ month: '2026-07', total: '2000.00', category_id: 100, category_name: 'Salaire' }),
  row({ month: '2026-07', total: '-500.00', category_id: 200, category_name: 'Loyer' }),
];

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{withTips(<>{children}</>)}</MemoryRouter>
    </QueryClientProvider>
  );
}

function mockApi(routes: {
  accounts?: Account[];
  perCurrency?: { currency: string; total: string }[];
  points?: BalancePoint[];
  categoryRows?: CategoryReportRow[];
  balanceError?: Error;
  settings?: { displayCurrency?: string | null };
}) {
  vi.mocked(api).mockImplementation(async (url: string) => {
    if (url === '/api/accounts') return { accounts: routes.accounts ?? [] };
    if (url === '/api/settings') return { settings: { displayCurrency: null, ...(routes.settings ?? {}) } };
    if (url === '/api/reports/balance') {
      if (routes.balanceError) throw routes.balanceError;
      return { perCurrency: routes.perCurrency ?? [{ currency: 'EUR', total: '1000.00' }] };
    }
    if (url === '/api/reports/timeseries') return { points: routes.points ?? [] };
    if (url === '/api/reports/categories') return { rows: routes.categoryRows ?? [] };
    if (url.startsWith('/api/tips/')) return { dismissed: {} };
    return {};
  });
}

describe('ForecastTab', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it('renders the "no history" empty state when the category report has no complete months', async () => {
    mockApi({ accounts: [account({ id: 1 })], categoryRows: [] });
    render(wrap(<ForecastTab />));
    const matches = await screen.findAllByText(/Pas encore assez d'historique/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('balance-chart')).not.toBeInTheDocument();
  });

  it('renders the chart and stat tiles when historical months are available', async () => {
    mockApi({
      accounts: [account({ id: 1 })],
      categoryRows: historyRows,
    });
    render(wrap(<ForecastTab />));
    expect(await screen.findByTestId('balance-chart')).toBeInTheDocument();
    expect(screen.getByText(/Solde prévu à J\+60/i)).toBeInTheDocument();
    expect(screen.getByText(/Variation prévue/i)).toBeInTheDocument();
    // Caption calls out the number of complete months averaged.
    expect(screen.getByText(/2 derniers mois complets/i)).toBeInTheDocument();
  });

  it('switches the horizon label when the user picks a different horizon', async () => {
    mockApi({
      accounts: [account({ id: 1 })],
      categoryRows: historyRows,
    });
    const user = userEvent.setup();
    render(wrap(<ForecastTab />));
    await screen.findByTestId('balance-chart');
    expect(screen.getByText(/Solde prévu à J\+60/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'J+180' }));
    await waitFor(() => {
      expect(screen.getByText(/Solde prévu à J\+180/i)).toBeInTheDocument();
    });
  });

  it('forwards settings.displayCurrency as the display query param on report queries', async () => {
    mockApi({
      accounts: [account({ id: 1 })],
      categoryRows: historyRows,
      settings: { displayCurrency: 'USD' },
    });
    render(wrap(<ForecastTab />));
    await screen.findByTestId('balance-chart');

    const calls = vi.mocked(api).mock.calls;
    const balanceCalls = calls.filter(([url]) => url === '/api/reports/balance');
    const timeseriesCalls = calls.filter(([url]) => url === '/api/reports/timeseries');
    // Both report queries must include display=USD once settings are ready,
    // matching the Dashboard cache key — otherwise ForecastTab shows raw
    // per-currency totals while Dashboard shows the converted view.
    expect(balanceCalls.some(([, init]) => (init as { query?: { display?: string } })?.query?.display === 'USD')).toBe(true);
    expect(timeseriesCalls.some(([, init]) => (init as { query?: { display?: string } })?.query?.display === 'USD')).toBe(true);
  });

  it('renders the error state when the balance query fails', async () => {
    mockApi({
      accounts: [account({ id: 1 })],
      balanceError: new Error('boom'),
      categoryRows: [],
    });
    render(wrap(<ForecastTab />));
    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('button')).not.toBeNull();
    expect(screen.queryByTestId('balance-chart')).not.toBeInTheDocument();
  });
});
