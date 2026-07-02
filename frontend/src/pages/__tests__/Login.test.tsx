import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Login } from '../Login';

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

  it('shows the error message when login fails', async () => {
    apiMock.mockImplementation(async (path: string, init?: any) => {
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
