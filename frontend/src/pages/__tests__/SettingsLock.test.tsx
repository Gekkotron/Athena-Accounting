import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsLock } from '../SettingsLock';
import { pinLocale } from '../../test/i18n';

// SettingsLock renders French strings by default (the app's current UI
// language). Preload the 'settings' namespace for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the French-literal assertions below keep matching real
// rendered text.
pinLocale('settings');

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: vi.fn(),
}));
import { api } from '../../api/client';
const mockedApi = vi.mocked(api);

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><SettingsLock /></QueryClientProvider>,
  );
}

beforeEach(() => { mockedApi.mockReset(); });

describe('SettingsLock', () => {
  it('renders nothing in session mode (LAN — account password is the lock)', async () => {
    mockedApi.mockResolvedValue({ mode: 'session', lockConfigured: true });
    const { container } = mount();
    await waitFor(() => expect(mockedApi).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the set form when unconfigured, and sets the password', async () => {
    mockedApi.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/auth/lock-status') return { mode: 'none', lockConfigured: false };
      if (path === '/api/auth/lock-password' && init?.method === 'PUT') return { lockConfigured: true };
      throw new Error(`unexpected: ${path}`);
    });
    mount();
    fireEvent.change(await screen.findByLabelText(/nouveau mot de passe/i), { target: { value: 'desk-lock-123' } });
    fireEvent.change(screen.getByLabelText(/confirmer/i), { target: { value: 'desk-lock-123' } });
    fireEvent.click(screen.getByRole('button', { name: /définir/i }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/api/auth/lock-password', {
        method: 'PUT', json: { newPassword: 'desk-lock-123' },
      }),
    );
  });

  it('offers change and remove when configured', async () => {
    mockedApi.mockResolvedValue({ mode: 'none', lockConfigured: true });
    mount();
    expect(await screen.findByLabelText(/mot de passe actuel/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /supprimer/i })).toBeInTheDocument();
  });

  it('rejects a mismatched confirmation client-side', async () => {
    mockedApi.mockResolvedValue({ mode: 'none', lockConfigured: false });
    mount();
    fireEvent.change(await screen.findByLabelText(/nouveau mot de passe/i), { target: { value: 'desk-lock-123' } });
    fireEvent.change(screen.getByLabelText(/confirmer/i), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: /définir/i }));
    expect(await screen.findByText(/ne correspondent pas/i)).toBeInTheDocument();
    expect(mockedApi).not.toHaveBeenCalledWith('/api/auth/lock-password', expect.anything());
  });
});
