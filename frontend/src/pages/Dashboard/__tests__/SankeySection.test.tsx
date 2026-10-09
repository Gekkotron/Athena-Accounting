import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fromDateFor, toDateFor, type RangeKey } from '../../../components/RangePicker';
import { SankeySection } from '../SankeySection';
import { pinLocale } from '../../../test/i18n';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderSection(opts: {
  range?: RangeKey;
  accountId?: number | 'all' | 'available';
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SankeySection
        range={opts.range ?? '12m'}
        currency="EUR"
        accountId={opts.accountId}
      />
    </QueryClientProvider>,
  );
}

// SankeySection renders French strings by default (the app's current UI
// language). Preload the 'dashboard' namespace for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the existing French-literal assertions below keep matching
// real rendered text (per the i18n migration recipe's locale-preserving-
// helper fallback).
pinLocale('dashboard', 'charts');

beforeEach(async () => {
  apiMock.mockReset();
});

it('renders the flow once data arrives', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') {
      return { categories: [
        { id: 1, name: 'Salaire', kind: 'income', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
        { id: 2, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
      ] } as any;
    }
    return { rows: [
      { category_id: 1, category_name: 'Salaire', category_kind: 'income', category_is_internal_transfer: false, month: '2026-06', total: '3000', transaction_count: 1 },
      { category_id: 2, category_name: 'Courses', category_kind: 'expense', category_is_internal_transfer: false, month: '2026-06', total: '-800', transaction_count: 1 },
    ] } as any;
  });
  renderSection();
  await waitFor(() => expect(screen.getByText('Revenus')).toBeInTheDocument());
  expect(screen.getByText('Salaire')).toBeInTheDocument();
});

it('shows an empty state when there is no income', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection();
  await waitFor(() => expect(screen.getByText(/Pas de revenus/i)).toBeInTheDocument());
});

it('renders the header suffix based on the range prop', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection({ range: '1m' });
  expect(await screen.findByText(/le mois dernier/i)).toBeInTheDocument();
});

it('forwards accountId to /api/reports/categories when a specific account is scoped', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection({ accountId: 42 });
  await waitFor(() => {
    const call = apiMock.mock.calls.find(([p]) => p === '/api/reports/categories');
    expect(call).toBeDefined();
    expect(call![1]?.query).toMatchObject({ accountId: 42 });
  });
});

it('omits accountId when scope is "all"', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection({ accountId: 'all' });
  await waitFor(() => {
    const call = apiMock.mock.calls.find(([p]) => p === '/api/reports/categories');
    expect(call).toBeDefined();
    expect(call![1]?.query).not.toHaveProperty('accountId');
  });
});

it('bounds the report window with both fromDate and toDate for month ranges', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection({ range: '6m' });
  await waitFor(() => {
    const call = apiMock.mock.calls.find(([p]) => p === '/api/reports/categories');
    expect(call).toBeDefined();
    expect(call![1]?.query).toMatchObject({
      fromDate: fromDateFor('6m'),
      toDate: toDateFor('6m'),
    });
  });
});

it('does not render its own account picker or range picker — those live in the shared ChartScopeBar', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection();
  // The account dropdown's accessible name was 'compte affiché'; the range
  // picker group's accessible name is the chart-range aria label. Neither
  // should appear inside the Sankey section.
  expect(screen.queryByLabelText(/compte affiché/i)).toBeNull();
  expect(screen.queryByRole('group', { name: /période|range/i })).toBeNull();
});
