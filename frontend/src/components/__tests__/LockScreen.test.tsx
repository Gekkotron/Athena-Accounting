import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LockProvider, LOCK_FLAG_KEY } from '../../contexts/LockContext';
import { LockScreen } from '../LockScreen';
import { api, ApiError } from '../../api/client';
import { pinLocale } from '../../test/i18n';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: vi.fn(),
}));
const mockedApi = vi.mocked(api);

pinLocale('layout');

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LockProvider>
        <LockScreen username="julien" />
        <div data-testid="app">app content</div>
      </LockProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem(LOCK_FLAG_KEY, '1'); // boot locked
  mockedApi.mockReset();
  mockedApi.mockImplementation(async (path: string) => {
    if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: true };
    if (path === '/api/auth/verify') return { ok: true };
    if (path === '/api/auth/logout') return { ok: true };
    throw new Error(`unexpected api call: ${path}`);
  });
});

describe('LockScreen', () => {
  it('shows the overlay with the username while locked', async () => {
    mount();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('julien')).toBeInTheDocument();
  });

  it('unlocks on correct password', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText(/mot de passe/i), { target: { value: 'good' } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the wrong-password error on 401 and stays locked', async () => {
    mockedApi.mockImplementation(async (path: string) => {
      if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: true };
      if (path === '/api/auth/verify') throw new ApiError('invalid credentials', 401, undefined);
      throw new Error(`unexpected api call: ${path}`);
    });
    mount();
    fireEvent.change(await screen.findByLabelText(/mot de passe/i), { target: { value: 'bad' } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(await screen.findByText(/mot de passe incorrect/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('session mode shows the logout escape hatch', async () => {
    mount();
    expect(await screen.findByText(/se déconnecter/i)).toBeInTheDocument();
  });

  it('shows the rate-limited message on 429 and stays locked', async () => {
    mockedApi.mockImplementation(async (path: string) => {
      if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: true };
      if (path === '/api/auth/verify') throw new ApiError('too many requests', 429, undefined);
      throw new Error(`unexpected api call: ${path}`);
    });
    mount();
    fireEvent.change(await screen.findByLabelText(/mot de passe/i), { target: { value: 'whatever' } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(await screen.findByText('Trop de tentatives — réessayez dans une minute.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('desktop mode (none, configured) shows the forgot-password hint and no logout button', async () => {
    mockedApi.mockImplementation(async (path: string) => {
      if (path === '/api/auth/lock-status') return { mode: 'none', lockConfigured: true };
      throw new Error(`unexpected api call: ${path}`);
    });
    mount();
    expect(await screen.findByText(/mot de passe oublié/i)).toBeInTheDocument();
    expect(screen.queryByText(/se déconnecter/i)).not.toBeInTheDocument();
  });

  it('clears the lock flag and boots to the login screen when the session died while idle', async () => {
    // The string 'authentication required' is a cross-service contract:
    // it must match the 401 body requireAuth sends in backend/src/http/plugins/auth.ts.
    mockedApi.mockImplementation(async (path: string) => {
      if (path === '/api/auth/lock-status') return { mode: 'session', lockConfigured: true };
      if (path === '/api/auth/verify') throw new ApiError('authentication required', 401, undefined);
      throw new Error(`unexpected api call: ${path}`);
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LockProvider>
          <LockScreen username="julien" />
          <div data-testid="app">app content</div>
        </LockProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByLabelText(/mot de passe/i), { target: { value: 'whatever' } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await waitFor(() => expect(localStorage.getItem(LOCK_FLAG_KEY)).toBeNull());
    expect(qc.getQueryData(['me'])).toEqual({ user: null });
  });
});
