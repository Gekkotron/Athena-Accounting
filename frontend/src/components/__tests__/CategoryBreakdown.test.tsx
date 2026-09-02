import { it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoryBreakdown } from '../CategoryBreakdown';
import { fromDateFor, toDateFor, type RangeKey } from '../RangePicker';
import { pinLocale } from '../../test/i18n';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

pinLocale('charts');

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
});

function renderBreakdown(range: RangeKey) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CategoryBreakdown range={range} onRangeChange={() => {}} />
    </QueryClientProvider>,
  );
}

it('bounds the report window with both fromDate and toDate for month ranges', async () => {
  renderBreakdown('6m');
  await waitFor(() => {
    const call = apiMock.mock.calls.find(([p]) => p === '/api/reports/categories');
    expect(call).toBeDefined();
    expect(call![1]?.query).toMatchObject({
      fromDate: fromDateFor('6m'),
      toDate: toDateFor('6m'),
    });
  });
});

it('excludes internal-transfer categories from both donut modes', async () => {
  // Self-transfers tagged with an is_internal_transfer category are neither
  // income nor expense — every other dashboard surface (Moyennes tiles,
  // Insights, Sankey) already skips them; the donut must agree or its total
  // contradicts N × the displayed monthly average.
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') {
      return { categories: [
        { id: 1, name: 'Salaire', kind: 'income', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
        { id: 2, name: 'Épargne interne', kind: 'income', color: null, parentId: null, isDefault: false, isInternalTransfer: true },
      ] } as any;
    }
    return { rows: [
      { category_id: 1, category_name: 'Salaire', category_kind: 'income', category_is_internal_transfer: false, month: '2026-06', total: '2500', transaction_count: 1 },
      { category_id: 2, category_name: 'Épargne interne', category_kind: 'income', category_is_internal_transfer: true, month: '2026-06', total: '1000', transaction_count: 1 },
    ] } as any;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { queryByText, findByText } = render(
    <QueryClientProvider client={client}>
      <CategoryBreakdown range="6m" onRangeChange={() => {}} defaultMode="income" />
    </QueryClientProvider>,
  );
  expect(await findByText(/Salaire/)).toBeInTheDocument();
  expect(queryByText(/Épargne interne/)).not.toBeInTheDocument();
});

it('sends neither fromDate nor toDate for the "all" range', async () => {
  renderBreakdown('all');
  await waitFor(() => {
    const call = apiMock.mock.calls.find(([p]) => p === '/api/reports/categories');
    expect(call).toBeDefined();
    expect(call![1]?.query).not.toHaveProperty('fromDate');
    expect(call![1]?.query).not.toHaveProperty('toDate');
  });
});

it('shows an ErrorState with retry when the report query fails', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    throw new Error('boom');
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { findByRole } = render(
    <QueryClientProvider client={client}>
      <CategoryBreakdown range="6m" onRangeChange={() => {}} />
    </QueryClientProvider>,
  );
  const alert = await findByRole('alert');
  expect(alert).toHaveTextContent(/Erreur de chargement des postes/);
  expect(alert).toHaveTextContent(/boom/);
});
