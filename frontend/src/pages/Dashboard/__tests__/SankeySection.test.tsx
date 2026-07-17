import { it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RangeKey } from '../../../components/RangePicker';
import { SankeySection } from '../SankeySection';
import i18n from '../../../i18n';

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
  onAccountChange?: (v: 'all' | number) => void;
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRangeChange = opts.onRangeChange ?? vi.fn();
  const onAccountChange = opts.onAccountChange ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <SankeySection
        range={opts.range ?? '12m'}
        onRangeChange={onRangeChange}
        currency="EUR"
        accountId={opts.accountId}
        accounts={[]}
        onAccountChange={onAccountChange}
        primaryCurrency="EUR"
      />
    </QueryClientProvider>,
  );
  return { ...utils, onRangeChange, onAccountChange };
}

// SankeySection renders French strings by default (the app's current UI
// language). Preload the 'dashboard' namespace for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the existing French-literal assertions below keep matching
// real rendered text (per the i18n migration recipe's locale-preserving-
// helper fallback).
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['dashboard', 'charts']);
});

beforeEach(async () => {
  await i18n.changeLanguage('fr');
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
  renderSection({ range: '30d' });
  expect(await screen.findByText(/sur 30 jours/i)).toBeInTheDocument();
});

it('clicking a range button in the header picker calls onRangeChange with that range', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  const { onRangeChange } = renderSection({ range: '6m' });
  const u = userEvent.setup();
  // The RangePicker is a role="group" of buttons labelled with the range
  // label ("30 j", "3 m", …). Click "12 m" to move to a longer range.
  await u.click(await screen.findByRole('button', { name: /^12 m$/ }));
  expect(onRangeChange).toHaveBeenCalledWith('12m');
});

it('marks the active range button with aria-pressed', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection({ range: 'all' });
  const active = await screen.findByRole('button', { name: /^Tout$/ });
  expect(active).toHaveAttribute('aria-pressed', 'true');
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

it('exposes the account selector in the header', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection();
  expect(await screen.findByLabelText(/compte affiché/i)).toBeInTheDocument();
});
