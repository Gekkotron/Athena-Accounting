import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Accounts } from '../Accounts';
import { ApiError } from '../../api/client';
import { withTips } from '../../test/renderWithProviders';
import { pinLocale } from '../../test/i18n';

// The Accounts page and its children (AccountCard, AccountForm, MergeModal,
// BalanceCheckpointsDrawer) use both the 'accounts' namespace and 'common'
// (Save/Cancel/Edit/Delete). Preload both for both locales, pinned to
// French, so `useTranslation` never suspends mid-render and the existing
// French-literal assertions below keep matching real rendered text.
pinLocale('accounts', 'tips');

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: vi.fn(),
  };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function renderAccounts() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {withTips(<Accounts />)}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// The form fields render a plain `<label>` sibling next to the `<input>`/
// `<select>` without a `for`/`id` association, so `getByLabelText` cannot
// find them. This helper locates the input by walking from the visible
// label text to its containing field wrapper.
function fieldFor(labelText: RegExp) {
  const label = screen.getByText(labelText, { selector: 'label' });
  const wrapper = label.parentElement as HTMLElement;
  const control = wrapper.querySelector('input, select');
  if (!control) throw new Error(`no input/select next to label matching ${labelText}`);
  return control as HTMLElement;
}

// Route → response mapping helper. Chained calls to `apiMock` see this map
// and return the recorded response (or throw the recorded error).
function seedRoutes(map: Record<string, unknown | ((body: unknown) => unknown)>) {
  apiMock.mockImplementation(async (path: string, init?: { json?: unknown; method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    const hit = map[key] ?? map[path];
    if (typeof hit === 'function') return (hit as (b: unknown) => unknown)(init?.json);
    if (hit instanceof Error) throw hit;
    if (hit === undefined) throw new Error(`unexpected api call: ${key}`);
    return hit;
  });
}

beforeEach(() => {
  apiMock.mockReset();
});

// Filename-pattern assertions live at
// pages/Accounts/__tests__/AccountPatternsPanel.test.tsx; the panel is
// mounted inline under the per-account edit view.
describe('Accounts page (characterization)', () => {
  it('renders the account list', async () => {
    seedRoutes({
      '/api/accounts': {
        accounts: [
          { id: 1, name: 'Compte courant', type: 'checking', currency: 'EUR',
            openingBalance: '100.00', openingDate: '2025-01-01',
            currentBalance: '250.00', transactionCount: 5, countedTransactionCount: 5,
            displayOrder: 0 },
          { id: 2, name: 'Livret A', type: 'savings', currency: 'EUR',
            openingBalance: '0.00', openingDate: '2025-01-01',
            currentBalance: '1000.00', transactionCount: 3, countedTransactionCount: 3,
            displayOrder: 1 },
        ],
      },
    });
    renderAccounts();
    expect((await screen.findAllByText('Compte courant')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Livret A').length).toBeGreaterThan(0);
  });

  it('creates an account and shows the new card after refetch', async () => {
    const created = { id: 3, name: 'Nouveau', type: 'checking', currency: 'EUR',
      openingBalance: '0.00', openingDate: '2026-01-01' };
    let listed = false;
    apiMock.mockImplementation(async (path: string, init?: { json?: unknown; method?: string }) => {
      if (path === '/api/accounts' && (!init || init.method === undefined)) {
        return { accounts: listed ? [{ ...created, currentBalance: '0.00',
          transactionCount: 0, countedTransactionCount: 0, displayOrder: 0 }] : [] };
      }
      if (path === '/api/account-filename-patterns') return { patterns: [] };
      if (path === '/api/accounts' && init?.method === 'POST') {
        listed = true;
        return { account: created };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderAccounts();
    await user.click(screen.getByRole('button', { name: /nouveau compte/i }));
    await user.type(fieldFor(/^nom$/i), 'Nouveau');
    // jsdom's `type="date"` input doesn't accept a typed "YYYY-MM-DD" string
    // via userEvent keystrokes, so set the value directly and fire the
    // change event the component listens for.
    fireEvent.change(fieldFor(/date d.ouverture/i), { target: { value: '2026-01-01' } });
    await user.click(screen.getByRole('button', { name: /créer/i }));

    expect((await screen.findAllByText('Nouveau')).length).toBeGreaterThan(0);
  });

  it('inline-edits an account name via PUT with only the changed field', async () => {
    const before = { id: 1, name: 'Old', type: 'checking', currency: 'EUR',
      openingBalance: '0.00', openingDate: '2025-01-01',
      currentBalance: '0.00', transactionCount: 0, countedTransactionCount: 0,
      displayOrder: 0 };
    const after = { ...before, name: 'New' };
    let putBody: any = null;
    let edited = false;
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts' && !init?.method) {
        return { accounts: [edited ? after : before] };
      }
      if (path === '/api/account-filename-patterns') return { patterns: [] };
      if (path === '/api/accounts/1' && init?.method === 'PUT') {
        putBody = init.json;
        edited = true;
        return { account: after };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderAccounts();
    await user.click(await screen.findByRole('button', { name: /modifier/i }));
    const nameInput = screen.getByDisplayValue('Old');
    await user.clear(nameInput);
    await user.type(nameInput, 'New');
    await user.click(screen.getByRole('button', { name: /enregistrer|sauvegarder|valider/i }));

    await waitFor(() => expect(putBody).toEqual({ name: 'New' }));
    expect(await screen.findAllByText('New')).not.toHaveLength(0);
  });

  it('confirms then deletes an account', async () => {
    const acc = { id: 1, name: 'Doomed', type: 'checking', currency: 'EUR',
      openingBalance: '0.00', openingDate: '2025-01-01',
      currentBalance: '0.00', transactionCount: 0, countedTransactionCount: 0,
      displayOrder: 0 };
    let deleted = false;
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts' && !init?.method) {
        return { accounts: deleted ? [] : [acc] };
      }
      if (path === '/api/account-filename-patterns') return { patterns: [] };
      if (path === '/api/accounts/1' && init?.method === 'DELETE') {
        deleted = true;
        return { ok: true };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderAccounts();
    // The delete trigger only appears inside the per-card edit mode.
    await user.click(await screen.findByRole('button', { name: /modifier/i }));
    await user.click(screen.getByRole('button', { name: /supprimer/i }));
    // ConfirmDialog appears — click the destructive confirm button.
    await user.click(await screen.findByRole('button', { name: /supprimer le compte/i }));

    await waitFor(() => expect(screen.queryByText('Doomed')).not.toBeInTheDocument());
  });

  it('shows an inline error when the checkpoint date conflicts', async () => {
    const acc = { id: 1, name: 'A', type: 'checking', currency: 'EUR',
      openingBalance: '0.00', openingDate: '2025-01-01',
      currentBalance: '0.00', transactionCount: 0, countedTransactionCount: 0,
      displayOrder: 0 };
    let firstCreated = false;
    const postBodies: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts' && !init?.method) return { accounts: [acc] };
      if (path === '/api/account-filename-patterns') return { patterns: [] };
      if (path === '/api/accounts/1/balance-checkpoints' && !init?.method) {
        return { checkpoints: firstCreated
          ? [{ id: 100, accountId: 1, checkpointDate: '2025-06-01',
              expectedAmount: '100.00', note: null, createdAt: '2026-01-01T00:00:00Z' }]
          : [] };
      }
      if (path === '/api/accounts/1/balance-checkpoints' && init?.method === 'POST') {
        postBodies.push(init.json);
        if (!firstCreated) {
          firstCreated = true;
          return { checkpoint: { id: 100, accountId: 1, checkpointDate: '2025-06-01',
            expectedAmount: '100.00', note: null, createdAt: '2026-01-01T00:00:00Z' } };
        }
        throw new ApiError('checkpoint_exists', 409, { error: 'checkpoint_exists', date: '2025-06-01' });
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });

    const user = userEvent.setup();
    renderAccounts();
    await user.click(await screen.findByRole('button', { name: /points de contrôle/i }));
    // jsdom's `type="date"` input doesn't accept a typed "YYYY-MM-DD" string
    // via userEvent keystrokes, so set the value directly and fire the
    // change event the component listens for (consistent with Test 2).
    fireEvent.change(screen.getByLabelText(/date du point de contrôle/i), { target: { value: '2025-06-01' } });
    await user.type(screen.getByLabelText(/montant attendu/i), '100.00');
    await user.click(screen.getByRole('button', { name: /\+\s*ajouter/i }));

    await screen.findByText('2025-06-01');
    expect(postBodies[0]).toEqual({ checkpointDate: '2025-06-01', expectedAmount: '100.00' });

    fireEvent.change(screen.getByLabelText(/date du point de contrôle/i), { target: { value: '2025-06-01' } });
    await user.type(screen.getByLabelText(/montant attendu/i), '200.00');
    await user.click(screen.getByRole('button', { name: /\+\s*ajouter/i }));

    expect(await screen.findByText(/existe déjà à cette date/i)).toBeInTheDocument();
    expect(postBodies[1]).toEqual({ checkpointDate: '2025-06-01', expectedAmount: '200.00' });
  });
});
