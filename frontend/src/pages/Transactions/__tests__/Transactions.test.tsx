import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Transactions } from '../index';
import type { Account, Category, Transaction } from '../../../api/types';
import { withTips } from '../../../test/renderWithProviders';
import { pinLocale } from '../../../test/i18n';

// Transactions renders French strings by default (the app's current UI
// language). Preload the 'transactions'/'common' namespaces for both locales
// so `useTranslation` never suspends mid-render, then pin the active
// language to French so the existing French-literal assertions below keep
// matching real rendered text (per the i18n migration recipe's
// locale-preserving-helper fallback).
pinLocale('transactions', 'tips');

// api() is the sole HTTP boundary; mock it as a dispatcher on (path, opts).
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

const acc: Account = {
  id: 1, name: 'Compte', type: 'checking', currency: 'EUR',
  openingBalance: '0.00', openingDate: '2025-01-01',
};
const cats: Category[] = [
  { id: 10, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
  { id: 11, name: 'Restaurants', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
];
const txs: Transaction[] = [
  {
    id: 1, accountId: 1, date: '2026-06-15', amount: '-10.00',
    rawLabel: 'A', normalizedLabel: 'a', memo: null, notes: null, fitid: null,
    dedupKey: 'x', categoryId: null, categorySource: 'auto',
    transferGroupId: null, sourceFileId: null, importedAt: '2026-06-15T00:00:00Z',
    splits: [],
  },
  {
    id: 2, accountId: 1, date: '2026-06-16', amount: '-20.00',
    rawLabel: 'B', normalizedLabel: 'b', memo: null, notes: null, fitid: null,
    dedupKey: 'y', categoryId: null, categorySource: 'auto',
    transferGroupId: null, sourceFileId: null, importedAt: '2026-06-16T00:00:00Z',
    splits: [],
  },
];

// Default dispatcher: return the fixture data for the four page-level GETs
// and swallow anything else. Individual tests override via mockImplementation
// when they need to assert POST bodies.
function defaultDispatcher(path: string): unknown {
  if (path === '/api/accounts') return { accounts: [acc] };
  if (path === '/api/categories') return { categories: cats };
  if (path.startsWith('/api/transactions?') || path === '/api/transactions') {
    return { transactions: txs, pagination: { total: txs.length, limit: 50, offset: 0 } };
  }
  if (path.startsWith('/api/balance-checkpoints')) return { checkpoints: [] };
  return {};
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {withTips(<Transactions />)}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function selectAllRows(user: ReturnType<typeof userEvent.setup>) {
  // Wait for the table to render, then click every row checkbox (there are
  // two body rows in the fixture). The header "select-all" checkbox works
  // too, but per-row clicks make the intent explicit.
  await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(2));
  const rowCbxs = screen.getAllByLabelText(/^Sélectionner la transaction/);
  for (const cbx of rowCbxs) await user.click(cbx);
}

beforeEach(async () => {
  apiMock.mockReset();
  apiMock.mockImplementation(((path: string) => Promise.resolve(defaultDispatcher(path))) as never);
});

describe('Transactions page — bulk category', () => {
  it('renders the bulk-category select when at least one row is selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await selectAllRows(user);
    expect(
      screen.getByLabelText('Changer la catégorie des transactions sélectionnées'),
    ).toBeInTheDocument();
  });

  it('picking a category POSTs categorize-bulk with the selected ids and categoryId', async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation(((path: string, opts?: { method?: string; json?: unknown }) => {
      if (opts?.method === 'POST' && path === '/api/transactions/categorize-bulk') {
        return Promise.resolve({ updated: 2, skipped: 0 });
      }
      return Promise.resolve(defaultDispatcher(path));
    }) as never);
    renderPage();
    await selectAllRows(user);

    const sel = screen.getByLabelText('Changer la catégorie des transactions sélectionnées');
    await user.selectOptions(sel, '10');

    await waitFor(() => {
      const call = apiMock.mock.calls.find(([p, o]) =>
        p === '/api/transactions/categorize-bulk' && (o as { method?: string })?.method === 'POST',
      );
      expect(call).toBeTruthy();
      expect((call![1] as { json: unknown }).json).toEqual({ ids: [1, 2], categoryId: 10 });
    });
  });

  it('picking "— Aucune" sends categoryId: null', async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation(((path: string, opts?: { method?: string; json?: unknown }) => {
      if (opts?.method === 'POST' && path === '/api/transactions/categorize-bulk') {
        return Promise.resolve({ updated: 2, skipped: 0 });
      }
      return Promise.resolve(defaultDispatcher(path));
    }) as never);
    renderPage();
    await selectAllRows(user);

    await user.selectOptions(
      screen.getByLabelText('Changer la catégorie des transactions sélectionnées'),
      'none',
    );

    await waitFor(() => {
      const call = apiMock.mock.calls.find(([p, o]) =>
        p === '/api/transactions/categorize-bulk' && (o as { method?: string })?.method === 'POST',
      );
      expect(call).toBeTruthy();
      expect((call![1] as { json: { categoryId: unknown } }).json.categoryId).toBeNull();
    });
  });

  it('on success with skipped>0 clears the selection and shows the skipped notice', async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation(((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST' && path === '/api/transactions/categorize-bulk') {
        return Promise.resolve({ updated: 1, skipped: 1 });
      }
      return Promise.resolve(defaultDispatcher(path));
    }) as never);
    renderPage();
    await selectAllRows(user);

    await user.selectOptions(
      screen.getByLabelText('Changer la catégorie des transactions sélectionnées'),
      '10',
    );

    await waitFor(() =>
      expect(screen.getByText(/1 ligne.*ignorée.*virements internes ou ventilations/i)).toBeInTheDocument(),
    );
    // Selection has cleared → the selection bar (and its select) is gone.
    expect(
      screen.queryByLabelText('Changer la catégorie des transactions sélectionnées'),
    ).not.toBeInTheDocument();
  });

  it('on error keeps the selection and shows the error message', async () => {
    const { ApiError } = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
    const user = userEvent.setup();
    apiMock.mockImplementation(((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST' && path === '/api/transactions/categorize-bulk') {
        return Promise.reject(new ApiError('catégorie inconnue', 400, { error: 'catégorie inconnue' }));
      }
      return Promise.resolve(defaultDispatcher(path));
    }) as never);
    renderPage();
    await selectAllRows(user);

    await user.selectOptions(
      screen.getByLabelText('Changer la catégorie des transactions sélectionnées'),
      '10',
    );

    await waitFor(() => expect(screen.getByText(/catégorie inconnue/i)).toBeInTheDocument());
    // Selection bar still present (selection persists on error).
    expect(
      screen.getByLabelText('Changer la catégorie des transactions sélectionnées'),
    ).toBeInTheDocument();
  });
});
