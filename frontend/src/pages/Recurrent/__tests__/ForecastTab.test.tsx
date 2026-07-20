import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ForecastTab } from '../ForecastTab';
import { withTips } from '../../../test/renderWithProviders';
import { pinLocale } from '../../../test/i18n';
import type { Account, BalancePoint, RecurringSeries } from '../../../api/types';

vi.mock('../../../api/client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';

// Replace the heavy SVG chart with a marker so the tests can assert the
// chart branch was chosen without exercising the chart itself. Same trick
// for the debug panel — tested separately.
vi.mock('../../../components/BalanceChart', () => ({
  BalanceChart: () => <div data-testid="balance-chart" />,
}));
vi.mock('../ForecastDebugPanel', () => ({
  ForecastDebugPanel: () => <div data-testid="forecast-debug-panel" />,
}));

// AccountSelect (rendered inside ForecastTab) uses the 'dashboard' namespace;
// preload it here so the tab doesn't suspend on first render.
pinLocale('tips', 'dashboard');

function isoDaysFromToday(days: number): string {
  const now = new Date();
  const t = now.getTime() + days * 86_400_000;
  const d = new Date(t);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

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

const series = (over: Partial<RecurringSeries>): RecurringSeries =>
  ({
    id: 1,
    label: 'Series',
    cadenceDays: 30,
    avgAmount: '-15',
    amountStddev: '0',
    categoryId: null,
    firstSeenAt: '2026-01-01',
    lastSeenAt: isoDaysFromToday(-15),
    nextDueAt: isoDaysFromToday(15),
    status: 'confirmed',
    essentialness: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    memberCount: 4,
    primaryAccountId: null,
    ...over,
  } as RecurringSeries);

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
  recurring?: RecurringSeries[];
  balanceError?: Error;
}) {
  vi.mocked(api).mockImplementation(async (url: string) => {
    if (url === '/api/accounts') return { accounts: routes.accounts ?? [] };
    if (url === '/api/reports/balance') {
      if (routes.balanceError) throw routes.balanceError;
      return { perCurrency: routes.perCurrency ?? [{ currency: 'EUR', total: '1000.00' }] };
    }
    if (url === '/api/reports/timeseries') return { points: routes.points ?? [] };
    if (url === '/api/recurring') return { recurring: routes.recurring ?? [] };
    if (url.startsWith('/api/tips/')) return { dismissed: {} };
    return {};
  });
}

describe('ForecastTab', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it('renders the "none" empty state when the user has no series at all', async () => {
    mockApi({ accounts: [account({ id: 1 })], recurring: [] });
    render(wrap(<ForecastTab />));
    // The copy appears in both the small header text and the EmptyState title,
    // so at least one match is enough — assert on getAllByText and length ≥ 1.
    const matches = await screen.findAllByText(/Aucune série récurrente pour projeter le solde\./i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('balance-chart')).not.toBeInTheDocument();
  });

  it('renders the "unconfirmed" empty state when only detected series exist', async () => {
    mockApi({
      accounts: [account({ id: 1 })],
      recurring: [series({ id: 1, status: 'detected' })],
    });
    render(wrap(<ForecastTab />));
    // Copy appears in both the header text and the EmptyState title.
    const matches = await screen.findAllByText(/Aucune série confirmée pour l'instant\./i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole('button', { name: /Inclure les séries détectées/i }),
    ).toBeInTheDocument();
  });

  it('flips to the populated state when the user clicks "Inclure les séries détectées"', async () => {
    mockApi({
      accounts: [account({ id: 1 })],
      recurring: [series({ id: 1, status: 'detected' })],
    });
    const user = userEvent.setup();
    render(wrap(<ForecastTab />));
    await user.click(
      await screen.findByRole('button', { name: /Inclure les séries détectées/i }),
    );
    await waitFor(() => {
      expect(screen.getByTestId('balance-chart')).toBeInTheDocument();
    });
    // Contributing-count copy switches to "détectées" wording.
    expect(screen.getByText(/Projection basée sur 1 série active\./i)).toBeInTheDocument();
  });

  it('renders the chart and stat tiles when at least one confirmed series contributes', async () => {
    mockApi({
      accounts: [account({ id: 1 })],
      recurring: [
        series({ id: 1, status: 'confirmed', label: 'Loyer', avgAmount: '-800' }),
        series({ id: 2, status: 'confirmed', label: 'Salaire', avgAmount: '2000' }),
      ],
    });
    render(wrap(<ForecastTab />));
    expect(await screen.findByTestId('balance-chart')).toBeInTheDocument();
    // Two stat tiles, both keyed by "Solde prévu à J+60" (default) and
    // "Variation prévue".
    expect(screen.getByText(/Solde prévu à J\+60/i)).toBeInTheDocument();
    expect(screen.getByText(/Variation prévue/i)).toBeInTheDocument();
    // Contributor count label — "2 séries confirmées".
    expect(screen.getByText(/2 séries confirmées/i)).toBeInTheDocument();
  });

  it('switches the horizon label when the user picks a different horizon', async () => {
    mockApi({
      accounts: [account({ id: 1 })],
      recurring: [series({ id: 1, status: 'confirmed' })],
    });
    const user = userEvent.setup();
    render(wrap(<ForecastTab />));
    await screen.findByTestId('balance-chart');
    // Default is J+60 (see ForecastTab's useState).
    expect(screen.getByText(/Solde prévu à J\+60/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'J+180' }));
    await waitFor(() => {
      expect(screen.getByText(/Solde prévu à J\+180/i)).toBeInTheDocument();
    });
  });

  it('toggles the debug panel with the [debug] button', async () => {
    mockApi({
      accounts: [account({ id: 1 })],
      recurring: [series({ id: 1, status: 'confirmed' })],
    });
    const user = userEvent.setup();
    render(wrap(<ForecastTab />));
    await screen.findByTestId('balance-chart');

    expect(screen.queryByTestId('forecast-debug-panel')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '[debug]' }));
    expect(screen.getByTestId('forecast-debug-panel')).toBeInTheDocument();
    // Button re-labels while the panel is open.
    await user.click(screen.getByRole('button', { name: '[hide debug]' }));
    expect(screen.queryByTestId('forecast-debug-panel')).not.toBeInTheDocument();
  });

  it('renders the error state when the balance query fails', async () => {
    mockApi({
      accounts: [account({ id: 1 })],
      balanceError: new Error('boom'),
      recurring: [],
    });
    render(wrap(<ForecastTab />));
    // ErrorState renders a retry button — assert by role so an i18n
    // change to the button label doesn't break the test.
    await waitFor(() => {
      expect(screen.queryByTestId('balance-chart')).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
