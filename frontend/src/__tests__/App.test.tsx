import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { PrivacyProvider } from '../contexts/PrivacyContext';
import { pinLocale } from '../test/i18n';

// App now reads a couple of translated strings directly (the loader text +
// the hub-tab labels passed to HubLayout). Preload the namespaces it needs
// so `useTranslation` never suspends mid-render.
pinLocale('layout', 'tips');

// The page-level components are covered by their own tests; here we just
// want the auth-gate + routing behavior. Stub them out with markers so the
// assertions don't depend on their internals.
vi.mock('../pages/Login', () => ({ Login: () => <div>login-page</div> }));
vi.mock('../pages/Dashboard', () => ({ Dashboard: () => <div>dashboard-page</div> }));
vi.mock('../pages/Transactions', () => ({ Transactions: () => <div>transactions-page</div> }));
vi.mock('../pages/Tri', () => ({ Tri: () => <div>tri-page</div> }));
vi.mock('../pages/Categories', () => ({ Categories: () => <div>categories-page</div> }));
vi.mock('../pages/Rules', () => ({ Rules: () => <div>rules-page</div> }));
vi.mock('../pages/Accounts', () => ({ Accounts: () => <div>accounts-page</div> }));
vi.mock('../pages/Imports', () => ({ Imports: () => <div>imports-page</div> }));
vi.mock('../pages/Profile', () => ({ Profile: () => <div>profile-page</div> }));
// Layout renders <Outlet/>; stub with a passthrough that shows the child.
vi.mock('../components/Layout', () => ({
  Layout: ({ user }: { user: { username: string } }) => (
    <div>
      <div data-testid="layout-user">{user.username}</div>
      {/* Outlet via react-router — we import it lazily to avoid the mock
          affecting other tests. */}
      <TestOutlet />
    </div>
  ),
}));
import { Outlet } from 'react-router-dom';
function TestOutlet() { return <Outlet />; }

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api, ApiError } from '../api/client';
const apiMock = vi.mocked(api);

function renderApp(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <PrivacyProvider>
          <App />
        </PrivacyProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('App router + auth gate', () => {
  it('shows the loader while /me is in flight', () => {
    apiMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderApp('/');
    expect(screen.getByText(/chargement/i)).toBeInTheDocument();
  });

  it('renders the Dashboard for an authenticated user at /', async () => {
    apiMock.mockResolvedValue({ user: { id: 1, username: 'julien' } });
    renderApp('/');
    expect(await screen.findByText('dashboard-page')).toBeInTheDocument();
    expect(screen.getByTestId('layout-user').textContent).toBe('julien');
  });

  it('renders the Transactions page at /transactions', async () => {
    apiMock.mockResolvedValue({ user: { id: 1, username: 'julien' } });
    renderApp('/transactions');
    expect(await screen.findByText('transactions-page')).toBeInTheDocument();
  });

  it('redirects unauthenticated users to /login', async () => {
    apiMock.mockImplementation(async () => {
      throw new ApiError('unauthorized', 401, null);
    });
    renderApp('/');
    expect(await screen.findByText('login-page')).toBeInTheDocument();
  });

  it('renders the Login page directly at /login without redirect', async () => {
    apiMock.mockImplementation(async () => {
      throw new ApiError('unauthorized', 401, null);
    });
    renderApp('/login');
    expect(await screen.findByText('login-page')).toBeInTheDocument();
  });

  it('bounces an already-authenticated user away from /login to /', async () => {
    apiMock.mockResolvedValue({ user: { id: 1, username: 'julien' } });
    renderApp('/login');
    // Expect the Dashboard mount, not the Login page.
    await waitFor(() => expect(screen.queryByText('login-page')).not.toBeInTheDocument());
    expect(await screen.findByText('dashboard-page')).toBeInTheDocument();
  });

  it('rethrows non-401 errors from /me (the useQuery keeps them as an error state)', async () => {
    apiMock.mockImplementation(async () => {
      throw new ApiError('server crashed', 500, null);
    });
    renderApp('/');
    // No login redirect on 500 — the loader / error state is expected. Just
    // assert the app does NOT render a page component.
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(screen.queryByText('login-page')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard-page')).not.toBeInTheDocument();
  });
});
