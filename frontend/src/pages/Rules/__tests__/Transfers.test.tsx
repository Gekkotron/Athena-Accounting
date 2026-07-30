import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Transfers } from '../Transfers';
import type { TransferRule } from '../../../api/types';
import { pinLocale } from '../../../test/i18n';

// Transfers renders French strings by default. Preload the 'rules' namespace
// for both locales, pinned to French, so `useTranslation` never suspends and
// the French-literal assertions below match real rendered text.
pinLocale('rules');

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

const accounts = [
  { id: 1, name: 'Compte courant' },
  { id: 2, name: 'Livret A' },
];

const rule = (id: number, keyword: string, extras: Partial<TransferRule> = {}): TransferRule => ({
  id,
  keyword,
  direction: 'outgoing',
  counterpartAccountId: null,
  enabled: true,
  ...extras,
});

function mockApi(rules: TransferRule[]) {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/api/transfer-rules' && !init?.method) return { transferRules: rules };
    if (path === '/api/accounts') return { accounts };
    if (path.startsWith('/api/transfer-rules')) return { ok: true };
    throw new Error(`unexpected: ${path}`);
  });
}

function renderTransfers() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Transfers />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('Transfers page', () => {
  it('renders each rule with its keyword and counterpart account name', async () => {
    mockApi([rule(1, 'virement interne', { counterpartAccountId: 2 }), rule(2, 'vir sepa')]);
    renderTransfers();

    expect(await screen.findByText('virement interne')).toBeInTheDocument();
    expect(screen.getByText('vir sepa')).toBeInTheDocument();
    expect(screen.getByText(/contrepartie : Livret A/)).toBeInTheDocument();
    expect(screen.getByText(/n'importe quel autre compte/)).toBeInTheDocument();
  });

  it('renders the empty state when there are no rules', async () => {
    mockApi([]);
    renderTransfers();

    expect(await screen.findByText('Aucune règle de virement')).toBeInTheDocument();
  });

  it('creating a rule POSTs keyword + counterpart with the outgoing default', async () => {
    mockApi([]);
    const user = userEvent.setup();
    renderTransfers();
    await screen.findByText('Aucune règle de virement');

    await user.type(screen.getByLabelText('Mot-clé'), '  virement interne  ');
    await user.selectOptions(await screen.findByLabelText('Compte de contrepartie'), '2');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/transfer-rules', {
        method: 'POST',
        json: {
          keyword: 'virement interne',
          counterpartAccountId: 2,
          direction: 'outgoing',
          enabled: true,
        },
      }),
    );
  });

  it('the enable/disable button PUTs the flipped enabled flag', async () => {
    mockApi([rule(7, 'virement interne')]);
    const user = userEvent.setup();
    renderTransfers();

    await user.click(await screen.findByRole('button', { name: 'Désactiver' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/transfer-rules/7', {
        method: 'PUT',
        json: { enabled: false },
      }),
    );
  });

  it('deleting asks for confirmation before firing the DELETE', async () => {
    mockApi([rule(7, 'virement interne')]);
    const user = userEvent.setup();
    renderTransfers();

    await user.click(await screen.findByRole('button', { name: 'Supprimer' }));
    // Dialog is open; nothing deleted yet.
    expect(apiMock).not.toHaveBeenCalledWith('/api/transfer-rules/7', expect.objectContaining({ method: 'DELETE' }));

    const dialogButtons = screen.getAllByRole('button', { name: 'Supprimer' });
    await user.click(dialogButtons[dialogButtons.length - 1]!);

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/transfer-rules/7', { method: 'DELETE' }),
    );
  });
});
