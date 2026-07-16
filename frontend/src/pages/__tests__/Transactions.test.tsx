import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Transactions } from '../Transactions';
import { withTips } from '../../test/renderWithProviders';
import i18n from '../../i18n';

// Transactions renders French strings by default (the app's current UI
// language). Preload the 'transactions'/'common' namespaces for both locales
// so `useTranslation` never suspends mid-render, then pin the active
// language to French so the existing French-literal assertions below keep
// matching real rendered text (per the i18n migration recipe's
// locale-preserving-helper fallback).
beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['transactions', 'common']);
});

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function renderTransactions() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {withTips(<Transactions />)}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Field-by-label helper for filter controls whose labels lack for/id association.
function fieldFor(labelText: string | RegExp): HTMLElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const control = label.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control found near label ${String(labelText)}`);
  return control as HTMLElement;
}

beforeEach(async () => {
  await i18n.changeLanguage('fr');
  apiMock.mockReset();
});

const acc = (id: number, name: string, currency = 'EUR') => ({
  id, name, type: 'checking', currency,
  openingBalance: '0.00', openingDate: '2025-01-01',
});

const cat = (id: number, name: string) => ({
  id, name, kind: 'expense' as const,
  color: null, parentId: null, isDefault: false,
});

const tx = (id: number, extras: Partial<any> = {}) => ({
  id, accountId: 1, date: '2026-06-15', amount: '-42.30',
  rawLabel: 'CB CARREFOUR', normalizedLabel: 'carrefour',
  memo: null, notes: null, fitid: null,
  dedupKey: `dk-${id}`, categoryId: null, categorySource: 'auto',
  transferGroupId: null, sourceFileId: null,
  importedAt: '2026-06-15T00:00:00Z',
  splits: [],
  ...extras,
});

describe('Transactions page (characterization)', () => {
  it('renders the transaction list with pagination controls', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'Compte')] };
      if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
      if (path === '/api/transactions') {
        return { transactions: [tx(1), tx(2)], pagination: { total: 2, limit: 50, offset: 0 } };
      }
      throw new Error(`unexpected: ${path}`);
    });

    renderTransactions();

    const rows = await screen.findAllByText('CB CARREFOUR');
    expect(rows).toHaveLength(2);
    expect(screen.getByText((_, el) => el?.textContent === '1–2 sur 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '‹' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '›' })).toBeDisabled();
  });

  it('refetches when the account filter changes', async () => {
    const queries: Record<string, unknown>[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'A'), acc(2, 'B')] };
      if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
      if (path === '/api/transactions') {
        queries.push(init?.query ?? {});
        return { transactions: [], pagination: { total: 0, limit: 50, offset: 0 } };
      }
      throw new Error(`unexpected: ${path}`);
    });

    const user = userEvent.setup();
    renderTransactions();
    await screen.findByText('Aucune transaction.');

    const accountSelect = fieldFor('Compte');
    await user.selectOptions(accountSelect, '2');

    await waitFor(() => {
      expect(queries.some((q) => q.accountId === 2)).toBe(true);
    });
  });

  it('applies the search filter immediately, with no debounce', async () => {
    const queries: Record<string, unknown>[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
      if (path === '/api/categories') return { categories: [] };
      if (path === '/api/transactions') {
        queries.push(init?.query ?? {});
        return { transactions: [], pagination: { total: 0, limit: 50, offset: 0 } };
      }
      throw new Error(`unexpected: ${path}`);
    });

    const user = userEvent.setup();
    renderTransactions();
    await screen.findByText('Aucune transaction.');

    const initialCallCount = queries.length;
    const searchInput = fieldFor('Recherche');
    await user.type(searchInput, 'carrefour');

    // No debounce mechanism exists in this component: each keystroke's
    // onChange updates filter state synchronously, so react-query refetches
    // without needing any timer advancement.
    await waitFor(() => {
      expect(queries.length).toBeGreaterThan(initialCallCount);
    });
    expect(queries.some((q) => q.search === 'carrefour')).toBe(true);
  });

  it('advances offset when the next-page control is clicked', async () => {
    const queries: Record<string, unknown>[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
      if (path === '/api/categories') return { categories: [] };
      if (path === '/api/transactions') {
        queries.push(init?.query ?? {});
        return {
          transactions: Array.from({ length: 50 }, (_, i) => tx(i + 1)),
          pagination: { total: 120, limit: 50, offset: 0 },
        };
      }
      throw new Error(`unexpected: ${path}`);
    });

    const user = userEvent.setup();
    renderTransactions();
    await screen.findAllByText('CB CARREFOUR');

    await user.click(screen.getByRole('button', { name: '›' }));

    await waitFor(() => {
      expect(queries.some((q) => q.offset === 50)).toBe(true);
    });
  });

  it('inline-edits a transaction category via PATCH with only the changed field', async () => {
    const original = tx(1, { categoryId: null });
    const updated = { ...original, categoryId: 10 };
    const patchBodies: any[] = [];
    let edited = false;
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
      if (path === '/api/categories') return { categories: [cat(10, 'Courses')] };
      if (path.startsWith('/api/transactions') && !path.includes('/api/transactions/')) {
        return { transactions: [edited ? updated : original], pagination: { total: 1, limit: 50, offset: 0 } };
      }
      if (path === '/api/transactions/1' && init?.method === 'PATCH') {
        patchBodies.push(init.json);
        edited = true;
        return { transaction: updated };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderTransactions();
    await screen.findByText('CB CARREFOUR');

    // The category cell renders a plain <select> (value "" = "—") that
    // fires the mutation directly on change — no separate edit affordance.
    const row = screen.getByText('CB CARREFOUR').closest('tr')!;
    await user.selectOptions(within(row).getAllByRole('combobox')[0], '10');

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ categoryId: 10 });
  });

  it('inline-edits notes via PATCH with only the changed field', async () => {
    const original = tx(1);
    const updated = { ...original, notes: 'new note' };
    const patchBodies: any[] = [];
    let edited = false;
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
      if (path === '/api/categories') return { categories: [] };
      if (path.startsWith('/api/transactions') && !path.includes('/api/transactions/')) {
        return { transactions: [edited ? updated : original], pagination: { total: 1, limit: 50, offset: 0 } };
      }
      if (path === '/api/transactions/1' && init?.method === 'PATCH') {
        patchBodies.push(init.json);
        edited = true;
        return { transaction: updated };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderTransactions();
    await screen.findByText('CB CARREFOUR');

    // The notes cell is a plain <input> that commits its value onBlur (Enter
    // triggers blur too) rather than on every keystroke.
    const notesInput = screen.getByPlaceholderText('…');
    await user.type(notesInput, 'new note');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ notes: 'new note' });
  });

  it('deletes a transaction after confirming', async () => {
    let deleted = false;
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
      if (path === '/api/categories') return { categories: [] };
      if (path.startsWith('/api/transactions') && !path.includes('/api/transactions/')) {
        return { transactions: deleted ? [] : [tx(1)], pagination: { total: deleted ? 0 : 1, limit: 50, offset: 0 } };
      }
      if (path === '/api/transactions/1' && init?.method === 'DELETE') {
        deleted = true;
        return { ok: true };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderTransactions();
    await screen.findByText('CB CARREFOUR');

    await user.click(screen.getByRole('button', { name: 'Supprimer' }));

    // ConfirmDialog appears with confirmLabel="Supprimer la transaction".
    await user.click(await screen.findByRole('button', { name: 'Supprimer la transaction' }));

    await waitFor(() => expect(screen.queryByText('CB CARREFOUR')).not.toBeInTheDocument());
  });

  it('opens the create-transaction modal when "Nouvelle transaction" is clicked', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/accounts') return { accounts: [acc(1, 'A')] };
      if (path === '/api/categories') return { categories: [] };
      if (path.startsWith('/api/transactions')) return { transactions: [], pagination: { total: 0, limit: 50, offset: 0 } };
      throw new Error(`unexpected: ${path}`);
    });

    const user = userEvent.setup();
    renderTransactions();
    await screen.findByText('Aucune transaction.');

    await user.click(screen.getByRole('button', { name: /nouvelle transaction/i }));

    // The modal has no <h1>/<h2> heading — "Nouvelle transaction" repeats as
    // a plain div title inside the dialog. Assert via the dialog role plus
    // the submit button's create-mode label, which is unique to the modal.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer la transaction' })).toBeInTheDocument();
  });
});
