import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SettingsBankSync } from '../SettingsBankSync';
import type { Account } from '../../api/types';
import { pinLocale } from '../../test/i18n';

pinLocale('settings');

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

const ACCOUNTS = [
  { id: 1, name: 'Compte courant', currency: 'EUR' },
  { id: 2, name: 'Livret A', currency: 'EUR' },
] as Account[];

const CONNECTION = {
  id: 11,
  aspspName: 'CIC',
  aspspCountry: 'FR',
  validUntil: '2099-01-01',
  status: 'active',
  createdAt: '2026-07-30T00:00:00Z',
  accounts: [
    {
      bankAccountUid: 'uid-1',
      iban: 'FR7612345',
      name: 'Compte Courant CIC',
      currency: 'EUR',
      accountId: null,
      lastSyncedAt: null,
    },
  ],
};

type Responses = Record<string, unknown>;

// Route the api mock by "METHOD path"; unrouted calls reject loudly.
function routeApi(responses: Responses): void {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    if (key in responses) return responses[key];
    throw new Error(`no mock for ${key}`);
  });
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsBankSync accounts={ACCOUNTS} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

describe('SettingsBankSync', () => {
  it('saves credentials and flips to the configured view', async () => {
    let configured = false;
    apiMock.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
      const key = `${init?.method ?? 'GET'} ${path}`;
      if (key === 'GET /api/bank-sync/status') {
        return configured
          ? { configured: true, applicationId: 'app-123' }
          : { configured: false, applicationId: null };
      }
      if (key === 'PUT /api/bank-sync/credentials') {
        configured = true;
        return { configured: true, applicationId: 'app-123' };
      }
      if (key === 'GET /api/bank-sync/connections') return { connections: [] };
      if (key === 'GET /api/bank-sync/aspsps') return { aspsps: [] };
      throw new Error(`no mock for ${key}`);
    });

    renderSection();
    const user = userEvent.setup();

    await user.type(
      await screen.findByLabelText("Identifiant d'application"),
      'app-123',
    );
    await user.type(
      screen.getByLabelText('Clé privée (PEM)'),
      'PEMKEY',
    );
    await user.click(screen.getByRole('button', { name: 'Enregistrer les identifiants' }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/api/bank-sync/credentials', {
        method: 'PUT',
        json: { applicationId: 'app-123', privateKey: 'PEMKEY' },
      });
    });
    expect(await screen.findByText(/Application configurée : app-123/)).toBeInTheDocument();
  });

  it('saves an account mapping from the connection card', async () => {
    routeApi({
      'GET /api/bank-sync/status': { configured: true, applicationId: 'app-123' },
      'GET /api/bank-sync/connections': { connections: [CONNECTION] },
      'GET /api/bank-sync/aspsps': { aspsps: [{ name: 'CIC', country: 'FR' }] },
      'PUT /api/bank-sync/connections/11/mappings': { connection: CONNECTION },
    });

    renderSection();
    const user = userEvent.setup();

    const select = await screen.findByLabelText(/Compte Athena pour Compte Courant CIC/);
    await user.selectOptions(select, '2');

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/api/bank-sync/connections/11/mappings', {
        method: 'PUT',
        json: { mappings: [{ bankAccountUid: 'uid-1', accountId: 2 }] },
      });
    });
  });

  it('shows the reconnect chip and button on a needs_reconnect connection', async () => {
    routeApi({
      'GET /api/bank-sync/status': { configured: true, applicationId: 'app-123' },
      'GET /api/bank-sync/connections': {
        connections: [{ ...CONNECTION, status: 'needs_reconnect' }],
      },
      'GET /api/bank-sync/aspsps': { aspsps: [] },
    });

    renderSection();

    expect(await screen.findByTestId('bank-sync-reconnect-chip-11')).toHaveTextContent(
      'Reconnexion requise',
    );
    expect(screen.getByRole('button', { name: 'Reconnecter' })).toBeInTheDocument();
    // A flagged connection is never synced against the bank from the UI.
    expect(screen.queryByRole('button', { name: 'Synchroniser' })).not.toBeInTheDocument();
  });

  it('shows the pre-expiry warning chip when the consent ends within 14 days', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    routeApi({
      'GET /api/bank-sync/status': { configured: true, applicationId: 'app-123' },
      'GET /api/bank-sync/connections': {
        connections: [{ ...CONNECTION, validUntil: soon }],
      },
      'GET /api/bank-sync/aspsps': { aspsps: [] },
    });

    renderSection();

    expect(await screen.findByText(/Reconnexion requise avant le/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnecter' })).toBeInTheDocument();
  });
});
