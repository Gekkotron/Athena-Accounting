import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Login } from '../Login';
import { pinLocale } from '../../test/i18n';

// Login renders French strings by default (the app's current UI language).
// Preload 'settings'/'common' for both locales and pin French so
// `useTranslation` never suspends mid-render and existing French-literal
// assertions keep matching real rendered text.
pinLocale('settings');

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('Login', () => {
  it('renders the login form when onboarding is complete', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: false };
      throw new Error(`unexpected: ${path}`);
    });
    renderLogin();
    expect(await screen.findByRole('heading', { name: /bon retour/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /se connecter/i })).toBeInTheDocument();
    // The register-mode toggle is offered.
    expect(screen.getByRole('button', { name: /créer un compte/i })).toBeInTheDocument();
  });

  it('POSTs /api/auth/login on submit', async () => {
    const posted: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: false };
      if (path === '/api/auth/login') {
        posted.push(init.json);
        return { user: { id: 1, username: init.json.username } };
      }
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: /bon retour/i });
    const inputs = screen.getAllByRole('textbox').concat(
      Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[],
    );
    await u.type(inputs[0]!, 'julien');
    await u.type(inputs[1]!, 'secretpwd');
    await u.click(screen.getByRole('button', { name: /se connecter/i }));
    await waitFor(() => expect(posted).toEqual([{ username: 'julien', password: 'secretpwd' }]));
  });

  it('clears a stale lock flag on successful login', async () => {
    // If the app locked itself and the session later expired, the
    // localStorage flag outlives the session — without clearing it here,
    // LockProvider boots locked and the user is asked for the password
    // again right after typing it into the login form.
    localStorage.setItem('athena.locked', '1');
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: false };
      if (path === '/api/auth/login') return { user: { id: 1, username: 'julien' } };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: /bon retour/i });
    const inputs = screen.getAllByRole('textbox').concat(
      Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[],
    );
    await u.type(inputs[0]!, 'julien');
    await u.type(inputs[1]!, 'secretpwd');
    await u.click(screen.getByRole('button', { name: /se connecter/i }));
    await waitFor(() => expect(localStorage.getItem('athena.locked')).toBeNull());
  });

  it('shows the error message when login fails', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: false };
      if (path === '/api/auth/login') {
        const err = Object.assign(new Error('identifiant ou mot de passe invalide'), {
          status: 401, data: {}, name: 'ApiError',
        });
        throw err;
      }
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: /bon retour/i });
    const inputs = screen.getAllByRole('textbox').concat(
      Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[],
    );
    await u.type(inputs[0]!, 'x');
    await u.type(inputs[1]!, 'y');
    await u.click(screen.getByRole('button', { name: /se connecter/i }));
    expect(await screen.findByText(/identifiant ou mot de passe invalide/i)).toBeInTheDocument();
  });

  it('renders the onboarding heading when needsOnboarding is true', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: true };
      throw new Error(`unexpected: ${path}`);
    });
    renderLogin();
    expect(await screen.findByRole('heading', { name: /première utilisation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /créer le compte/i })).toBeInTheDocument();
  });

  it('rejects register submits with password < 8 chars', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: true };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: /première utilisation/i });
    const inputs = screen.getAllByRole('textbox').concat(
      Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[],
    );
    await u.type(inputs[0]!, 'julien');
    await u.type(inputs[1]!, 'short');
    await u.type(inputs[2]!, 'short');
    await u.click(screen.getByRole('button', { name: /créer le compte/i }));
    expect(await screen.findByText(/au moins 8 caractères/i)).toBeInTheDocument();
  });

  it('rejects register submits when passwords do not match', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: true };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: /première utilisation/i });
    const inputs = screen.getAllByRole('textbox').concat(
      Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[],
    );
    await u.type(inputs[0]!, 'julien');
    await u.type(inputs[1]!, 'longpassword1');
    await u.type(inputs[2]!, 'longpassword2');
    await u.click(screen.getByRole('button', { name: /créer le compte/i }));
    expect(await screen.findByText(/ne correspondent pas/i)).toBeInTheDocument();
  });

  it('advances to the TOTP step when /api/auth/login returns requiresTotp:true', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: false };
      if (path === '/api/auth/login') return { requiresTotp: true };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: /bon retour/i });
    const inputs = screen.getAllByRole('textbox').concat(
      Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[],
    );
    await u.type(inputs[0]!, 'julien');
    await u.type(inputs[1]!, 'secretpwd');
    await u.click(screen.getByRole('button', { name: /se connecter/i }));
    // Second step: 6-digit input + verify button + recovery link.
    expect(await screen.findByLabelText(/code à 6 chiffres/i)).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByLabelText(/code à 6 chiffres/i)).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByRole('button', { name: /vérifier/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /utiliser un code de récupération/i })).toBeInTheDocument();
  });

  it('POSTs the 6-digit code to /api/auth/2fa/verify on submit', async () => {
    const posted: unknown[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: false };
      if (path === '/api/auth/login') return { requiresTotp: true };
      if (path === '/api/auth/2fa/verify') {
        posted.push(init.json);
        return { user: { id: 1, username: 'julien' } };
      }
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: /bon retour/i });
    const inputs = screen.getAllByRole('textbox').concat(
      Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[],
    );
    await u.type(inputs[0]!, 'julien');
    await u.type(inputs[1]!, 'secretpwd');
    await u.click(screen.getByRole('button', { name: /se connecter/i }));
    const codeInput = await screen.findByLabelText(/code à 6 chiffres/i);
    await u.type(codeInput, '123456');
    await u.click(screen.getByRole('button', { name: /vérifier/i }));
    await waitFor(() => expect(posted).toEqual([{ code: '123456' }]));
  });

  it('toggles the recovery-code input via "Utiliser un code de récupération"', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: false };
      if (path === '/api/auth/login') return { requiresTotp: true };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: /bon retour/i });
    const inputs = screen.getAllByRole('textbox').concat(
      Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[],
    );
    await u.type(inputs[0]!, 'julien');
    await u.type(inputs[1]!, 'secretpwd');
    await u.click(screen.getByRole('button', { name: /se connecter/i }));
    await screen.findByLabelText(/code à 6 chiffres/i);
    await u.click(screen.getByRole('button', { name: /utiliser un code de récupération/i }));
    expect(await screen.findByLabelText(/code de récupération/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /utiliser un code totp/i })).toBeInTheDocument();
  });

  it('shows the error inline on an invalid TOTP code (401)', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: false };
      if (path === '/api/auth/login') return { requiresTotp: true };
      if (path === '/api/auth/2fa/verify') {
        const err = Object.assign(new Error('invalid code'), {
          status: 401, data: { error: 'invalid code' }, name: 'ApiError',
        });
        throw err;
      }
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: /bon retour/i });
    const inputs = screen.getAllByRole('textbox').concat(
      Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[],
    );
    await u.type(inputs[0]!, 'julien');
    await u.type(inputs[1]!, 'secretpwd');
    await u.click(screen.getByRole('button', { name: /se connecter/i }));
    const codeInput = await screen.findByLabelText(/code à 6 chiffres/i);
    await u.type(codeInput, '999999');
    await u.click(screen.getByRole('button', { name: /vérifier/i }));
    expect(await screen.findByText(/code invalide/i)).toBeInTheDocument();
    // Still on the TOTP step, not bounced back to step 1.
    expect(screen.getByLabelText(/code à 6 chiffres/i)).toBeInTheDocument();
  });

  it('POSTs /api/onboarding/create on successful register', async () => {
    const posted: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/onboarding/status') return { needsOnboarding: true };
      if (path === '/api/onboarding/create') {
        posted.push(init.json);
        return { user: { id: 1, username: init.json.username } };
      }
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: /première utilisation/i });
    const inputs = screen.getAllByRole('textbox').concat(
      Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[],
    );
    await u.type(inputs[0]!, 'julien');
    await u.type(inputs[1]!, 'longpassword');
    await u.type(inputs[2]!, 'longpassword');
    await u.click(screen.getByRole('button', { name: /créer le compte/i }));
    await waitFor(() => expect(posted).toEqual([{ username: 'julien', password: 'longpassword' }]));
  });
});
