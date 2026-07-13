import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RangeKey } from '../../../components/RangePicker';
import { SankeySection } from '../SankeySection';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderSection(opts: {
  range?: RangeKey;
  onRangeChange?: (r: RangeKey) => void;
  accountId?: number | 'all';
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRangeChange = opts.onRangeChange ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <SankeySection
        range={opts.range ?? '12m'}
        onRangeChange={onRangeChange}
        currency="EUR"
        accountId={opts.accountId}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onRangeChange };
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

it('renders the header suffix based on the range prop', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection({ range: '30d' });
  expect(await screen.findByText(/sur 30 jours/i)).toBeInTheDocument();
});

it('clicking the "longer range" chevron calls onRangeChange with the next-longer range', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  const { onRangeChange } = renderSection({ range: '6m' });
  const u = userEvent.setup();
  await u.click(await screen.findByRole('button', { name: /période plus longue/i }));
  expect(onRangeChange).toHaveBeenCalledWith('12m');
});

it('disables the "longer" chevron on `all`', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection({ range: 'all' });
  const longer = await screen.findByRole('button', { name: /période plus longue/i });
  expect(longer).toBeDisabled();
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

it('disables the "shorter" chevron on `30d`', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection({ range: '30d' });
  const shorter = await screen.findByRole('button', { name: /période plus courte/i });
  expect(shorter).toBeDisabled();
});
