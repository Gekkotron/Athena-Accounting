import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Suspense } from 'react';
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
vi.mock('../../pages/Budgets/Plafonds', () => ({ Plafonds: () => <div>plafonds-page</div> }));
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
  // Mirrors main.tsx: App is wrapped in a Suspense boundary in production.
  // lib/format now imports the shared i18n singleton (for locale-aware
  // formatting), so importing App here pulls that singleton's async .init()
  // into this test's module graph — the very first render can suspend on it
  // the same way a real page load would, and needs a boundary to land on.
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <PrivacyProvider>
          <Suspense fallback={<div />}>
            <App />
          </Suspense>
        </PrivacyProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// [from, to, marker rendered once the redirect lands on `to`]
// Only hub-index defaults — the app is pre-release, no external bookmarks,
// so English-slug legacy redirects were dropped.
const cases: Array<[string, string, string]> = [
  ['/rules', '/rules/sort', 'tri-page'],
  ['/accounts/', '/accounts', 'accounts-page'],
  ['/data', '/data/imports', 'imports-page'],
  ['/budgets', '/budgets/caps', 'plafonds-page'],
];

describe.each(cases)('redirect %s → %s', (from, to, marker) => {
  beforeEach(() => vi.clearAllMocks());

  it(`lands on ${to} and renders the target page`, async () => {
    renderAt(from);
    expect(await screen.findByText(marker)).toBeInTheDocument();
  });
});
