import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountPatternsPanel } from '../AccountPatternsPanel';
import { pinLocale } from '../../../test/i18n';

pinLocale('accounts');

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderPanel(accountId: number, patterns: any[] = []) {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/account-filename-patterns') return { patterns };
    throw new Error(`unexpected: ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AccountPatternsPanel accountId={accountId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

describe('AccountPatternsPanel', () => {
  it('lists only patterns belonging to this account', async () => {
    renderPanel(1, [
      { id: 10, pattern: 'mine_a', accountId: 1, priority: 0 },
      { id: 11, pattern: 'someone_elses', accountId: 2, priority: 0 },
      { id: 12, pattern: 'mine_b', accountId: 1, priority: 5 },
    ]);
    expect(await screen.findByText('mine_a')).toBeInTheDocument();
    expect(screen.getByText('mine_b')).toBeInTheDocument();
    expect(screen.queryByText('someone_elses')).not.toBeInTheDocument();
  });

  it('submits POST with the account id from props', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
      if (path === '/api/account-filename-patterns' && !init?.method) return { patterns: [] };
      if (path === '/api/account-filename-patterns' && init?.method === 'POST') {
        return { pattern: { id: 99, ...(init.json as object) } };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    renderPanel(7);
    await user.type(screen.getByPlaceholderText(/ex\. releve_courant/i), 'releve_courant');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/api/account-filename-patterns',
        expect.objectContaining({
          method: 'POST',
          json: expect.objectContaining({
            pattern: 'releve_courant',
            accountId: 7,
            priority: 0,
          }),
        }),
      ),
    );
  });

  it('submits DELETE when the row delete button is clicked', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/account-filename-patterns' && !init?.method) {
        return { patterns: [{ id: 42, pattern: 'x', accountId: 3, priority: 0 }] };
      }
      if (init?.method === 'DELETE') return { ok: true };
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <AccountPatternsPanel accountId={3} />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'supprimer' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/api/account-filename-patterns/42',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});
