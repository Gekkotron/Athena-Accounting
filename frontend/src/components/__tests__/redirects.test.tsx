import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Outlet } from 'react-router-dom';
import App from '../../App';
import { PrivacyProvider } from '../../contexts/PrivacyContext';

// Stub every page with a marker so the assertions target routing behavior,
// not page internals — mirrors the pattern in src/__tests__/App.test.tsx.
// This also sidesteps the need to fake per-page API response shapes: the
// mocked pages never call `api()` themselves.
vi.mock('../../pages/Login', () => ({ Login: () => <div>login-page</div> }));
vi.mock('../../pages/Dashboard', () => ({ Dashboard: () => <div>dashboard-page</div> }));
vi.mock('../../pages/Transactions', () => ({ Transactions: () => <div>transactions-page</div> }));
vi.mock('../../pages/Rules/Tri', () => ({ Tri: () => <div>tri-page</div> }));
vi.mock('../../pages/Rules/Categories', () => ({ Categories: () => <div>categories-page</div> }));
vi.mock('../../pages/Budgets', () => ({ Budgets: () => <div>budgets-page</div> }));
vi.mock('../../pages/Rules', () => ({ Rules: () => <div>rules-page</div> }));
vi.mock('../../pages/Accounts', () => ({ Accounts: () => <div>accounts-page</div> }));
vi.mock('../../pages/Data/Imports', () => ({ Imports: () => <div>imports-page</div> }));
vi.mock('../../pages/Data/Duplicates', () => ({ Duplicates: () => <div>duplicates-page</div> }));
vi.mock('../../pages/Data/PdfTemplates', () => ({ PdfTemplates: () => <div>pdf-templates-page</div> }));
vi.mock('../../pages/Data/Backup', () => ({ Backup: () => <div>backup-page</div> }));
vi.mock('../../pages/Profile', () => ({ Profile: () => <div>profile-page</div> }));
vi.mock('../../pages/Settings', () => ({ Settings: () => <div>settings-page</div> }));

// Layout renders <Outlet/> around the routed page; stub it with a
// passthrough so nested (hub) routes still mount. HubLayout (Task 1) is left
// un-mocked — it's a pure presentational component with no data fetching.
vi.mock('../../components/Layout', () => ({
  Layout: () => <TestOutlet />,
}));
function TestOutlet() {
  return <Outlet />;
}

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn().mockResolvedValue({ user: { id: 1, username: 'julien' } }) };
});

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <PrivacyProvider>
          <App />
        </PrivacyProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// [from, to, marker rendered once the redirect lands on `to`]
const cases: Array<[string, string, string]> = [
  ['/tri', '/regles/tri', 'tri-page'],
  ['/rules', '/regles/liste', 'rules-page'],
  ['/categories', '/regles/categories', 'categories-page'],
  ['/accounts', '/comptes', 'accounts-page'],
  ['/imports', '/donnees/imports', 'imports-page'],
  ['/settings', '/reglages', 'settings-page'],
  ['/profile', '/profil', 'profile-page'],
  ['/regles', '/regles/tri', 'tri-page'],
  ['/comptes/', '/comptes', 'accounts-page'],
  ['/donnees', '/donnees/imports', 'imports-page'],
];

describe.each(cases)('redirect %s → %s', (from, to, marker) => {
  beforeEach(() => vi.clearAllMocks());

  it(`lands on ${to} and renders the target page`, async () => {
    renderAt(from);
    expect(await screen.findByText(marker)).toBeInTheDocument();
  });
});
