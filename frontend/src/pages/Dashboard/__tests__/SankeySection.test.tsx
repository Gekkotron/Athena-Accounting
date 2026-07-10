import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SankeySection } from '../SankeySection';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SankeySection range="12m" currency="EUR" />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiMock.mockReset());

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
