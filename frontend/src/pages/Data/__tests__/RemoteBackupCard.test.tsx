import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RemoteBackupCard } from '../RemoteBackupCard';
import { pinLocale } from '../../../test/i18n';

pinLocale('imports');

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

const UNCONFIGURED = { configured: false, auto: { enabled: true, hour: 3, nextAt: null } };
const CONFIGURED = {
  configured: true,
  kind: 'folder',
  enabled: true,
  config: { path: '/mnt/nas/backups', keepLast: 30 },
  lastRunAt: '2026-08-05T03:00:12Z',
  lastError: null,
  auto: { enabled: true, hour: 3, nextAt: '2026-08-06T03:00:00Z' },
};

function routeApi(responses: Record<string, unknown>): void {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    if (key in responses) return responses[key];
    throw new Error(`no mock for ${key}`);
  });
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RemoteBackupCard />
    </QueryClientProvider>,
  );
}

// Braces matter: mockReset() returns the mock, and a beforeEach return
// value is treated by vitest as a teardown hook (it would then "run" the
// api mock with no arguments after every test).
beforeEach(() => {
  apiMock.mockReset();
});

describe('RemoteBackupCard', () => {
  it('unconfigured: shows the form; switching kind swaps the fields', async () => {
    routeApi({
      'GET /api/backup/destination': UNCONFIGURED,
      'GET /api/settings': { settings: { backupHour: 3 } },
    });
    renderCard();
    // WebDAV is the default kind — URL field visible.
    expect(await screen.findByLabelText(/URL/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /dossier/i }));
    expect(screen.getByLabelText(/chemin/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/URL/i)).not.toBeInTheDocument();
  });

  it('saving a folder destination PUTs the built payload', async () => {
    routeApi({
      'GET /api/backup/destination': UNCONFIGURED,
      'GET /api/settings': { settings: { backupHour: 3 } },
      'PUT /api/backup/destination': CONFIGURED,
    });
    renderCard();
    await userEvent.click(await screen.findByRole('radio', { name: /dossier/i }));
    await userEvent.type(screen.getByLabelText(/chemin/i), '/mnt/nas/backups');
    await userEvent.type(screen.getByLabelText(/phrase secrète/i), 'strong-backup-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /tester et enregistrer/i }));
    await waitFor(() => {
      const put = apiMock.mock.calls.find(([, init]) => (init as { method?: string })?.method === 'PUT');
      expect(put).toBeDefined();
      expect((put![1] as { json: unknown }).json).toEqual({
        kind: 'folder',
        path: '/mnt/nas/backups',
        keepLast: 30,
        passphrase: 'strong-backup-passphrase',
      });
    });
  });

  it('saving an ftp destination PUTs the built payload', async () => {
    routeApi({
      'GET /api/backup/destination': UNCONFIGURED,
      'GET /api/settings': { settings: { backupHour: 3 } },
      'PUT /api/backup/destination': { ...CONFIGURED, kind: 'ftp' },
    });
    renderCard();
    await userEvent.click(await screen.findByRole('radio', { name: /ftp/i }));
    await userEvent.type(screen.getByLabelText(/serveur ftp/i), 'mafreebox.freebox.fr');
    await userEvent.type(screen.getByLabelText(/utilisateur/i), 'freebox');
    await userEvent.type(screen.getByLabelText(/mot de passe/i), 'p4ss');
    await userEvent.type(screen.getByLabelText(/phrase secrète/i), 'strong-backup-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /tester et enregistrer/i }));
    await waitFor(() => {
      const put = apiMock.mock.calls.find(([, init]) => (init as { method?: string })?.method === 'PUT');
      expect(put).toBeDefined();
      expect((put![1] as { json: unknown }).json).toEqual({
        kind: 'ftp',
        host: 'mafreebox.freebox.fr',
        port: 21,
        username: 'freebox',
        password: 'p4ss',
        keepLast: 30,
        passphrase: 'strong-backup-passphrase',
      });
    });
  });

  it('configured: shows last run and fires run-now', async () => {
    routeApi({
      'GET /api/backup/destination': CONFIGURED,
      'GET /api/settings': { settings: { backupHour: 3 } },
      'POST /api/backup/destination/run-now': { filename: 'athena-backup-2026-08-05-140000.enc.json' },
    });
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: /sauvegarder maintenant/i }));
    expect(await screen.findByText(/athena-backup-2026-08-05-140000\.enc\.json/)).toBeInTheDocument();
  });

  it('shows the backend detail when the destination test fails', async () => {
    const { ApiError } = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const key = `${init?.method ?? 'GET'} ${path}`;
      if (key === 'GET /api/backup/destination') return UNCONFIGURED;
      if (key === 'GET /api/settings') return { settings: { backupHour: 3 } };
      if (key === 'PUT /api/backup/destination') {
        throw new ApiError('destination test failed', 502, {
          error: 'destination test failed',
          detail: 'ftp login: authentication failed (530)',
        });
      }
      throw new Error(`no mock for ${key}`);
    });
    renderCard();
    await userEvent.click(await screen.findByRole('radio', { name: /dossier/i }));
    await userEvent.type(screen.getByLabelText(/chemin/i), '/mnt/backups');
    await userEvent.type(screen.getByLabelText(/phrase secrète/i), 'strong-backup-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /tester et enregistrer/i }));
    expect(await screen.findByText(/authentication failed \(530\)/)).toBeInTheDocument();
  });

  it('surfaces lastError from the status', async () => {
    routeApi({
      'GET /api/backup/destination': { ...CONFIGURED, lastError: 'webdav upload: HTTP 401' },
      'GET /api/settings': { settings: { backupHour: 3 } },
    });
    renderCard();
    expect(await screen.findByText(/HTTP 401/)).toBeInTheDocument();
  });
});
