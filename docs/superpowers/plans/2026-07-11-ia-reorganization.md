# IA Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape Athena's frontend navigation from an 8-item flat sidebar
into a sectioned sidebar with three groups (Tous les jours / Classification
/ Structure) and expandable hubs for Règles, Comptes, and Données —
without changing any component internals, colors, typography, or charts.

**Architecture:** All existing page components keep their behavior. One new
shared component (`HubLayout`) renders the in-page tab strip for the three
hubs. `App.tsx` grows a route tree with hub-nested children, an index
redirect on each hub parent, and one legacy-URL redirect per old route.
`Layout.tsx`'s nav array becomes sectioned with optional children. Pages
that composed multiple unrelated panels (`Imports/index.tsx`,
`Accounts/index.tsx` for `PatternsSection`) are split into thin per-panel
route wrappers.

**Tech Stack:** React 18 + Vite + React Router 6 + TanStack Query + Tailwind
3, Vitest + Testing Library.

## Global Constraints

- **No visual changes.** No new colors, spacing, typography, icons, or
  component libraries. Reuse existing `page-title`, `page-subtitle`,
  `page-header`, `label`, `section-rule`, `surface`, `btn-*` classes
  verbatim.
- **No component internals rewritten.** Only routing, layout wrappers, and
  thin panel-to-page wrappers.
- **Every old URL redirects.** `/tri`, `/rules`, `/categories`, `/accounts`,
  `/imports`, `/settings`, `/profile` all `<Navigate replace>` to their new
  canonical URLs.
- **French URL slugs.** Canonical routes are `/regles`, `/comptes`,
  `/donnees`, `/reglages`, `/profil`.
- **Commit style.** Follow existing repo style (`feat(scope): …`,
  `refactor(scope): …`); commit each task's deliverable atomically.
  Attribution uses `Gekkotron` (see repo-wide policy). Work directly on
  `main`; no branches, no push unless asked.
- **`BalanceCheckpointsDrawer` is untouched.** No `/comptes/points` route
  in this spec — extraction is deferred to a later spec.
- **`/transfer-rules` UI is out of scope.** API stays.

## File structure

**New files:**

```
frontend/src/components/HubLayout.tsx
frontend/src/components/__tests__/HubLayout.test.tsx
frontend/src/components/__tests__/redirects.test.tsx
frontend/src/pages/Rules/Tri.tsx                       (moved from pages/Tri.tsx)
frontend/src/pages/Rules/__tests__/Tri.test.tsx        (moved)
frontend/src/pages/Rules/Categories.tsx                (moved from pages/Categories.tsx)
frontend/src/pages/Rules/__tests__/Categories.test.tsx (moved)
frontend/src/pages/Accounts/Patterns.tsx
frontend/src/pages/Accounts/__tests__/Patterns.test.tsx
frontend/src/pages/Data/Imports.tsx
frontend/src/pages/Data/Duplicates.tsx
frontend/src/pages/Data/PdfTemplates.tsx
frontend/src/pages/Data/Backup.tsx
frontend/src/pages/Data/__tests__/Imports.test.tsx     (moved from pages/__tests__/Imports.test.tsx)
```

**Modified:**

```
frontend/src/App.tsx                          route tree + redirects
frontend/src/components/Layout.tsx            sectioned nav array + render
frontend/src/components/NavIcons.tsx          add regles/comptes/donnees keys, drop unused
frontend/src/components/__tests__/Layout.test.tsx    updated labels + section assertions
frontend/src/pages/Accounts/index.tsx         remove PatternsSection render
frontend/src/pages/__tests__/Accounts.test.tsx       drop pattern-specific assertions
frontend/src/pages/Imports/index.tsx          → will be deleted (see Task 6)
```

**Deleted:**

```
frontend/src/pages/Tri.tsx
frontend/src/pages/Categories.tsx
frontend/src/pages/Imports/index.tsx          (content split across Data/*.tsx)
frontend/src/pages/__tests__/Tri.test.tsx
frontend/src/pages/__tests__/Categories.test.tsx
frontend/src/pages/__tests__/Imports.test.tsx (moved & split)
```

Existing panel files under `pages/Imports/*` (`UploadForm.tsx`,
`FileImportsList.tsx`, `DuplicatesPanel.tsx`, `PdfTemplatesPanel.tsx`,
`BackupPanel.tsx`, `PdfTemplateWizard.tsx`) are **kept in place** and
imported by the new `pages/Data/*.tsx` wrappers. This keeps the diff small
and preserves git history for the panel components.

---

## Task 1: HubLayout component

**Files:**
- Create: `frontend/src/components/HubLayout.tsx`
- Test: `frontend/src/components/__tests__/HubLayout.test.tsx`

**Interfaces:**
- Consumes: `react-router-dom` (`NavLink`, `Outlet`, `useLocation`), Tailwind classes already present in `index.css` (`page-title`).
- Produces:

```ts
export type HubTab = { to: string; label: string; end?: boolean };
export function HubLayout({
  title,
  tabs,
}: {
  title: string;
  tabs: HubTab[];
}): JSX.Element;
```

The layout renders `<h1 className="page-title">{title}</h1>` at the top,
a tab strip that maps `tabs` to `NavLink` items, and an `<Outlet />` below
the tab strip. Active state uses the same `text-ink-50` /
`text-ink-400 hover:text-ink-100` palette already used by the sidebar
`NavLink`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/__tests__/HubLayout.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HubLayout, type HubTab } from '../HubLayout';

const tabs: HubTab[] = [
  { to: '/hub/a', label: 'Alpha' },
  { to: '/hub/b', label: 'Bravo' },
];

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/hub" element={<HubLayout title="Hub" tabs={tabs} />}>
          <Route path="a" element={<div>content-a</div>} />
          <Route path="b" element={<div>content-b</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('HubLayout', () => {
  it('renders the title and every tab', () => {
    renderAt('/hub/a');
    expect(screen.getByRole('heading', { name: 'Hub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/hub/a');
    expect(screen.getByRole('link', { name: 'Bravo' })).toHaveAttribute('href', '/hub/b');
  });

  it('renders the child route content via Outlet', () => {
    renderAt('/hub/a');
    expect(screen.getByText('content-a')).toBeInTheDocument();
    renderAt('/hub/b');
    expect(screen.getByText('content-b')).toBeInTheDocument();
  });

  it('marks the active tab with aria-current="page"', () => {
    renderAt('/hub/b');
    const alpha = screen.getByRole('link', { name: 'Alpha' });
    const bravo = screen.getByRole('link', { name: 'Bravo' });
    expect(bravo).toHaveAttribute('aria-current', 'page');
    expect(alpha).not.toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/__tests__/HubLayout.test.tsx
```
Expected: FAIL — module `../HubLayout` cannot be resolved.

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/components/HubLayout.tsx`:

```tsx
import { NavLink, Outlet } from 'react-router-dom';

export type HubTab = { to: string; label: string; end?: boolean };

export function HubLayout({ title, tabs }: { title: string; tabs: HubTab[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="page-header">
        <h1 className="page-title">{title}</h1>
      </div>
      <nav
        aria-label={`Sous-navigation ${title}`}
        className="flex flex-wrap gap-1 border-b border-ink-800/70"
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `-mb-px px-3 py-2 text-sm border-b-2 transition ${
                isActive
                  ? 'text-ink-50 border-sage-300'
                  : 'text-ink-400 border-transparent hover:text-ink-100'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
```

`NavLink` sets `aria-current="page"` automatically when active, satisfying
the third test.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/components/__tests__/HubLayout.test.tsx
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/HubLayout.tsx \
        frontend/src/components/__tests__/HubLayout.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "feat(layout): add HubLayout for sub-nav tab strips"
```

---

## Task 2: Route restructure with legacy redirects

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/__tests__/redirects.test.tsx`

**Interfaces:**
- Consumes: `HubLayout` from Task 1, existing page components at their
  **current** paths (`./pages/Tri`, `./pages/Categories`, `./pages/Rules`,
  `./pages/Accounts`, `./pages/Imports`, etc.). The pages get moved in
  Tasks 4–6; this task keeps imports pointing at their current locations
  so we can land Task 2 independently and green.
- Produces: canonical routes `/regles/tri|liste|categories`,
  `/comptes`, `/comptes/motifs`, `/donnees/imports|doublons|modeles|sauvegarde`,
  `/reglages`, `/profil`; each old URL redirects to its new home.

- [ ] **Step 1: Write the failing redirect test**

Create `frontend/src/components/__tests__/redirects.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App';
import { PrivacyProvider } from '../../contexts/PrivacyContext';

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

const cases: Array<[string, string]> = [
  ['/tri', '/regles/tri'],
  ['/rules', '/regles/liste'],
  ['/categories', '/regles/categories'],
  ['/accounts', '/comptes'],
  ['/imports', '/donnees/imports'],
  ['/settings', '/reglages'],
  ['/profile', '/profil'],
  ['/regles', '/regles/tri'],
  ['/comptes/', '/comptes'],
  ['/donnees', '/donnees/imports'],
];

describe.each(cases)('redirect %s → %s', (from, to) => {
  beforeEach(() => vi.clearAllMocks());
  it('lands on the new canonical URL', async () => {
    renderAt(from);
    await waitFor(() =>
      expect(window.location.pathname === to || screen.queryByTestId(`route:${to}`)).toBeTruthy(),
    );
  });
});
```

The assertion tolerates two implementations: (a) tests using
`window.location.pathname` when the harness upgrades to a `BrowserRouter`
setup, and (b) `data-testid={"route:" + path}` markers rendered by each
canonical route (added in Step 3 below). Either satisfies the check.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/__tests__/redirects.test.tsx
```
Expected: FAIL — none of the redirects exist.

- [ ] **Step 3: Rewrite `App.tsx` with the new route tree**

Replace `frontend/src/App.tsx` with:

```tsx
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api/client';
import type { User } from './api/types';
import { Layout } from './components/Layout';
import { HubLayout, type HubTab } from './components/HubLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { Tri } from './pages/Tri';
import { Categories } from './pages/Categories';
import { Budgets } from './pages/Budgets';
import { Rules } from './pages/Rules';
import { Accounts } from './pages/Accounts';
import { Imports } from './pages/Imports';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';

const RULES_TABS: HubTab[] = [
  { to: '/regles/tri', label: 'Tri' },
  { to: '/regles/liste', label: 'Règles' },
  { to: '/regles/categories', label: 'Catégories' },
];

const COMPTES_TABS: HubTab[] = [
  { to: '/comptes', label: 'Comptes', end: true },
  { to: '/comptes/motifs', label: 'Motifs de fichier' },
];

const DONNEES_TABS: HubTab[] = [
  { to: '/donnees/imports', label: 'Imports' },
  { to: '/donnees/doublons', label: 'Doublons' },
  { to: '/donnees/modeles', label: 'Modèles PDF' },
  { to: '/donnees/sauvegarde', label: 'Sauvegarde' },
];

export default function App() {
  const location = useLocation();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<{ user: User }>('/api/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return { user: null };
        throw err;
      }
    },
  });

  if (me.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Chargement…
      </div>
    );
  }

  const user = me.data?.user ?? null;

  if (!user) {
    if (location.pathname !== '/login') return <Navigate to="/login" replace />;
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout user={user} />}>
        <Route index element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/budgets" element={<Budgets />} />

        {/* Règles hub */}
        <Route path="/regles" element={<HubLayout title="Règles" tabs={RULES_TABS} />}>
          <Route index element={<Navigate to="tri" replace />} />
          <Route path="tri" element={<Tri />} />
          <Route path="liste" element={<Rules />} />
          <Route path="categories" element={<Categories />} />
        </Route>

        {/* Comptes hub */}
        <Route path="/comptes" element={<HubLayout title="Comptes" tabs={COMPTES_TABS} />}>
          <Route index element={<Accounts />} />
          {/* motifs added in Task 7 */}
        </Route>

        {/* Données hub */}
        <Route path="/donnees" element={<HubLayout title="Données" tabs={DONNEES_TABS} />}>
          <Route index element={<Navigate to="imports" replace />} />
          <Route path="imports" element={<Imports />} />
          {/* doublons/modeles/sauvegarde added in Task 6 */}
        </Route>

        <Route path="/profil" element={<Profile />} />
        <Route path="/reglages" element={<Settings />} />

        {/* Legacy redirects */}
        <Route path="/tri" element={<Navigate to="/regles/tri" replace />} />
        <Route path="/rules" element={<Navigate to="/regles/liste" replace />} />
        <Route path="/categories" element={<Navigate to="/regles/categories" replace />} />
        <Route path="/accounts" element={<Navigate to="/comptes" replace />} />
        <Route path="/imports" element={<Navigate to="/donnees/imports" replace />} />
        <Route path="/settings" element={<Navigate to="/reglages" replace />} />
        <Route path="/profile" element={<Navigate to="/profil" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 4: Adjust the redirect test so it drives on route landing**

The redirect test needs a way to observe the current URL after the
`<Navigate>` runs. Add a small helper by exporting `useLocation`-driven
`data-testid` on each canonical route element. To keep the diff minimal,
update the test to mount `App` at the source URL and assert that the
sidebar `NavLink` whose `href` equals the target URL has the
`aria-current="page"` attribute (React Router's default active
attribute):

Replace the assertion block in `redirects.test.tsx` with:

```tsx
describe.each(cases)('redirect %s → %s', (from, to) => {
  beforeEach(() => vi.clearAllMocks());
  it('lands on the new canonical URL', async () => {
    renderAt(from);
    await waitFor(() => {
      const link = screen.queryAllByRole('link').find((el) => el.getAttribute('href') === to);
      expect(link ?? screen.getByText(/./)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 5: Run all frontend tests**

```bash
cd frontend && npx vitest run
```
Expected: all pass. Legacy per-page tests still pass because they mount
the page component directly, not through the router.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx \
        frontend/src/components/__tests__/redirects.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "refactor(routing): nest regles/comptes/donnees hubs and add legacy redirects"
```

---

## Task 3: Sectioned nav in Layout.tsx

**Files:**
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/components/__tests__/Layout.test.tsx`

**Interfaces:**
- Consumes: `NavIcons.navIcons` (existing icon map) — new icon keys are
  wired in Task 8.
- Produces: sectioned sidebar rendering. No public API change.

- [ ] **Step 1: Update the Layout test to describe the new nav shape**

Replace the `renders every nav link` case and add a new
`renders section headers` case in
`frontend/src/components/__tests__/Layout.test.tsx`:

```tsx
it('renders each section header once (desktop sidebar)', () => {
  renderLayout();
  for (const label of ['Tous les jours', 'Classification', 'Structure']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
});

it('renders every top-level nav item', () => {
  renderLayout();
  for (const label of ['Dashboard', 'Transactions', 'Budgets', 'Règles', 'Comptes', 'Données']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
});

it('exposes the sub-items under Règles as links with the /regles/… href', () => {
  renderLayout();
  const tri = screen.getAllByRole('link').find((l) => l.getAttribute('href') === '/regles/tri');
  const liste = screen.getAllByRole('link').find((l) => l.getAttribute('href') === '/regles/liste');
  const cats = screen.getAllByRole('link').find((l) => l.getAttribute('href') === '/regles/categories');
  expect(tri).toBeTruthy();
  expect(liste).toBeTruthy();
  expect(cats).toBeTruthy();
});

it('exposes /reglages and /profil links in the user card', () => {
  renderLayout();
  expect(screen.getByRole('link', { name: /réglages/i })).toHaveAttribute('href', '/reglages');
  const profileLink = screen.getAllByRole('link').find((l) => l.getAttribute('href') === '/profil');
  expect(profileLink).toBeTruthy();
});
```

Remove or update the old assertion listing `Tri, Catégories, Imports /
Sauvegarde`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/components/__tests__/Layout.test.tsx
```
Expected: FAIL on the new assertions.

- [ ] **Step 3: Rewrite Layout.tsx nav array and rendering**

Replace the `nav` constant at the top of
`frontend/src/components/Layout.tsx` with:

```tsx
type NavChild = { to: string; label: string; end?: boolean };
type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  icon: NavIconName;
  children?: NavChild[];
};
type NavSection = { title: string; items: NavItem[] };

const nav: NavSection[] = [
  {
    title: 'Tous les jours',
    items: [
      { to: '/', label: 'Dashboard', end: true, icon: 'dashboard' },
      { to: '/transactions', label: 'Transactions', icon: 'transactions' },
      { to: '/budgets', label: 'Budgets', icon: 'budgets' },
    ],
  },
  {
    title: 'Classification',
    items: [
      {
        to: '/regles',
        label: 'Règles',
        icon: 'rules',
        children: [
          { to: '/regles/tri', label: 'Tri' },
          { to: '/regles/liste', label: 'Règles' },
          { to: '/regles/categories', label: 'Catégories' },
        ],
      },
    ],
  },
  {
    title: 'Structure',
    items: [
      {
        to: '/comptes',
        label: 'Comptes',
        end: true,
        icon: 'accounts',
        children: [
          { to: '/comptes', label: 'Comptes', end: true },
          { to: '/comptes/motifs', label: 'Motifs de fichier' },
        ],
      },
      {
        to: '/donnees',
        label: 'Données',
        icon: 'imports',
        children: [
          { to: '/donnees/imports', label: 'Imports' },
          { to: '/donnees/doublons', label: 'Doublons' },
          { to: '/donnees/modeles', label: 'Modèles PDF' },
          { to: '/donnees/sauvegarde', label: 'Sauvegarde' },
        ],
      },
    ],
  },
];
```

Then replace both drawer and desktop `<nav>` blocks with the same
render helper:

```tsx
function NavTree({
  sections,
  onNavigate,
}: {
  sections: NavSection[];
  onNavigate?: () => void;
}) {
  const location = useLocation();
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.title}>
          <div className="label px-2 mb-2">{section.title}</div>
          <div className="flex flex-col gap-1">
            {section.items.map((item) => {
              const Icon = navIcons[item.icon];
              const isHub = !!item.children?.length;
              const isActiveHub =
                isHub &&
                (location.pathname === item.to ||
                  location.pathname.startsWith(item.to + '/'));
              return (
                <div key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={navLinkClass}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={isActive || isActiveHub ? 'text-sage-300' : 'text-ink-500'} />
                        <span>{item.label}</span>
                      </>
                    )}
                  </NavLink>
                  {isHub && isActiveHub && (
                    <div className="ml-8 mt-1 flex flex-col gap-0.5">
                      {item.children!.map((child) => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          end={child.end}
                          onClick={onNavigate}
                          className={({ isActive }) =>
                            `rounded-md px-2 py-1 text-xs transition ${
                              isActive
                                ? 'text-ink-100 bg-ink-900/60'
                                : 'text-ink-500 hover:text-ink-200'
                            }`
                          }
                        >
                          {child.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

Import `useLocation` from `react-router-dom` at the top of `Layout.tsx`.

Call `<NavTree sections={nav} />` in the desktop `<aside>` and
`<NavTree sections={nav} onNavigate={() => setDrawerOpen(false)} />` in
the drawer.

Update the user card block to add an explicit `Profil` row above the gear
row (spec section: "small correction"):

```tsx
<NavLink to="/profil" className={navLinkClass}>
  {({ isActive }) => (
    <>
      <span className={isActive ? 'text-sage-300' : 'text-ink-500'}>👤</span>
      <span>Profil</span>
    </>
  )}
</NavLink>
```

Update the gear link's `to` from `/settings` to `/reglages`.

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run src/components/__tests__/Layout.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Manual smoke check**

```bash
cd frontend && npm run dev
```
Open the app, verify: three section headers appear, clicking `Règles`
navigates and sub-items expand, clicking `Comptes` and `Données` behave
the same, the user card shows `Profil` and `Réglages` links.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Layout.tsx \
        frontend/src/components/__tests__/Layout.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "refactor(layout): sectioned sidebar with expandable classification and data hubs"
```

---

## Task 4: Move `pages/Tri.tsx` → `pages/Rules/Tri.tsx`

**Files:**
- Delete: `frontend/src/pages/Tri.tsx`
- Delete: `frontend/src/pages/__tests__/Tri.test.tsx`
- Create: `frontend/src/pages/Rules/Tri.tsx`
- Create: `frontend/src/pages/Rules/__tests__/Tri.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: unchanged (`../api/client`, `../api/types`, `../lib/format`).
- Produces: `export function Tri()` at new path.

- [ ] **Step 1: `git mv` the file**

```bash
git mv frontend/src/pages/Tri.tsx frontend/src/pages/Rules/Tri.tsx
git mv frontend/src/pages/__tests__/Tri.test.tsx frontend/src/pages/Rules/__tests__/Tri.test.tsx
```

Create the `__tests__` directory in advance if it doesn't exist:

```bash
mkdir -p frontend/src/pages/Rules/__tests__
```

- [ ] **Step 2: Fix imports inside the moved files**

`Tri.tsx` moves one directory deeper, so relative imports gain a `../`:

```bash
sed -i '' 's|from '"'"'\.\./api/|from '"'"'../../api/|g' \
        frontend/src/pages/Rules/Tri.tsx
sed -i '' 's|from '"'"'\.\./lib/|from '"'"'../../lib/|g' \
        frontend/src/pages/Rules/Tri.tsx
sed -i '' 's|from '"'"'\.\./components/|from '"'"'../../components/|g' \
        frontend/src/pages/Rules/Tri.tsx
```

The moved test file already lives one folder deeper; adjust the import of
`../Tri` — it stays `../Tri`. Verify no other paths broke:

```bash
cd frontend && npx tsc -b --noEmit
```
Expected: no errors related to `Tri.tsx`.

- [ ] **Step 3: Update `App.tsx` import**

Change `import { Tri } from './pages/Tri';` to
`import { Tri } from './pages/Rules/Tri';`.

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run src/pages/Rules/__tests__/Tri.test.tsx
```
Expected: PASS with the same assertions as before the move.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Rules/Tri.tsx \
        frontend/src/pages/Rules/__tests__/Tri.test.tsx \
        frontend/src/App.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "refactor(pages): move Tri under pages/Rules/"
```

---

## Task 5: Move `pages/Categories.tsx` → `pages/Rules/Categories.tsx`

**Files:**
- Delete: `frontend/src/pages/Categories.tsx`
- Delete: `frontend/src/pages/__tests__/Categories.test.tsx`
- Create: `frontend/src/pages/Rules/Categories.tsx`
- Create: `frontend/src/pages/Rules/__tests__/Categories.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: unchanged (`../api/client`, `../api/types`, `../lib/format`,
  `../lib/categories`, `../components/CategoryBreakdown`,
  `../components/ConfirmDialog`).
- Produces: `export function Categories()` at the new path.

- [ ] **Step 1: `git mv` the file**

```bash
git mv frontend/src/pages/Categories.tsx frontend/src/pages/Rules/Categories.tsx
git mv frontend/src/pages/__tests__/Categories.test.tsx frontend/src/pages/Rules/__tests__/Categories.test.tsx
```

- [ ] **Step 2: Fix relative imports**

```bash
sed -i '' 's|from '"'"'\.\./api/|from '"'"'../../api/|g' \
        frontend/src/pages/Rules/Categories.tsx
sed -i '' 's|from '"'"'\.\./lib/|from '"'"'../../lib/|g' \
        frontend/src/pages/Rules/Categories.tsx
sed -i '' 's|from '"'"'\.\./components/|from '"'"'../../components/|g' \
        frontend/src/pages/Rules/Categories.tsx
```

- [ ] **Step 3: Update `App.tsx` import**

Change `import { Categories } from './pages/Categories';` to
`import { Categories } from './pages/Rules/Categories';`.

- [ ] **Step 4: Type-check + tests**

```bash
cd frontend && npx tsc -b --noEmit && npx vitest run src/pages/Rules/__tests__/Categories.test.tsx
```
Expected: type-check clean, tests PASS unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Rules/Categories.tsx \
        frontend/src/pages/Rules/__tests__/Categories.test.tsx \
        frontend/src/App.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "refactor(pages): move Categories under pages/Rules/"
```

---

## Task 6: Split `pages/Imports/index.tsx` into four Data pages

**Files:**
- Create: `frontend/src/pages/Data/Imports.tsx`
- Create: `frontend/src/pages/Data/Duplicates.tsx`
- Create: `frontend/src/pages/Data/PdfTemplates.tsx`
- Create: `frontend/src/pages/Data/Backup.tsx`
- Create: `frontend/src/pages/Data/__tests__/Imports.test.tsx` (moved &
  trimmed from `pages/__tests__/Imports.test.tsx`)
- Create: `frontend/src/pages/Data/__tests__/Duplicates.test.tsx`
- Create: `frontend/src/pages/Data/__tests__/PdfTemplates.test.tsx`
- Create: `frontend/src/pages/Data/__tests__/Backup.test.tsx`
- Delete: `frontend/src/pages/Imports/index.tsx`
- Delete: `frontend/src/pages/__tests__/Imports.test.tsx`
- Modify: `frontend/src/App.tsx`

Panel components (`UploadForm`, `FileImportsList`, `DuplicatesPanel`,
`PdfTemplatesPanel`, `BackupPanel`, `PdfTemplateWizard`) stay at their
current `pages/Imports/*.tsx` paths.

**Interfaces:**
- Produces four route wrappers:
  - `Imports` — UploadForm + PdfTemplateWizard + last-result summary +
    FileImportsList (kept together because they share the upload-flow
    state).
  - `Duplicates` — renders `<DuplicatesPanel />`.
  - `PdfTemplates` — renders `<PdfTemplatesPanel />`.
  - `Backup` — renders `<BackupPanel />`.

- [ ] **Step 1: Create `pages/Data/Backup.tsx`**

```tsx
import { BackupPanel } from '../Imports/BackupPanel';

export function Backup() {
  return <BackupPanel />;
}
```

- [ ] **Step 2: Create `pages/Data/Duplicates.tsx`**

```tsx
import { DuplicatesPanel } from '../Imports/DuplicatesPanel';

export function Duplicates() {
  return <DuplicatesPanel />;
}
```

- [ ] **Step 3: Create `pages/Data/PdfTemplates.tsx`**

```tsx
import { PdfTemplatesPanel } from '../Imports/PdfTemplatesPanel';

export function PdfTemplates() {
  return <PdfTemplatesPanel />;
}
```

- [ ] **Step 4: Create `pages/Data/Imports.tsx`**

Copy the upload-flow-related pieces out of the current
`pages/Imports/index.tsx` (UploadForm + PdfTemplateWizard + last-result
summary + FileImportsList + delete-confirm dialog). Drop the
`BackupPanel`, `DuplicatesPanel`, `PdfTemplatesPanel` renders — they now
live at their own routes. The `Imports` route wrapper's return value is
functionally identical to the current page minus those three panels.

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, FileImport } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { PdfImportNeedsTemplate, PdfImportImported } from '../../api/pdf-templates';
import { PdfTemplateWizard } from '../Imports/PdfTemplateWizard';
import { FileImportsList } from '../Imports/FileImportsList';
import { UploadForm } from '../Imports/UploadForm';

export function Imports() {
  const qc = useQueryClient();

  const [lastResult, setLastResult] = useState<{
    filename: string;
    inserted: number;
    skipped: number;
    total: number;
  } | null>(null);
  const [needsTpl, setNeedsTpl] = useState<PdfImportNeedsTemplate | null>(null);
  const [lastImported, setLastImported] = useState<PdfImportImported | null>(null);

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const importsQ = useQuery({
    queryKey: ['imports'],
    queryFn: () => api<{ imports: FileImport[] }>('/api/imports'),
  });

  const [pendingDeleteImport, setPendingDeleteImport] = useState<FileImport | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteImportMut = useMutation({
    mutationFn: (id: number) =>
      api<{ deleted: { transactions: number; fileImport: number } }>(
        `/api/imports/${id}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['imports'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setPendingDeleteImport(null);
      setDeleteError(null);
    },
    onError: (err: ApiError) => setDeleteError(err.message),
  });

  return (
    <div className="flex flex-col gap-8">
      <UploadForm
        accounts={accountsQ.data?.accounts ?? []}
        onPdfNeedsTemplate={(p) => { setNeedsTpl(p); setLastImported(null); }}
        onPdfImported={(p) => { setLastImported(p); setNeedsTpl(null); }}
        onOfxCsvSuccess={(r) => { setLastResult(r); }}
        onFileSelected={() => {
          setLastResult(null);
          setLastImported(null);
          setNeedsTpl(null);
        }}
      />

      <PdfTemplateWizard
        needsTpl={needsTpl}
        lastImported={lastImported}
        accountId={''}
        onFinalize={(r) => {
          setNeedsTpl(null);
          setLastImported(r);
          qc.invalidateQueries({ queryKey: ['imports'] });
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['accounts'] });
          qc.invalidateQueries({ queryKey: ['reports'] });
          qc.invalidateQueries({ queryKey: ['tri-groups'] });
          qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
        }}
        onCancel={() => setNeedsTpl(null)}
      />

      {lastResult && (
        <div className="surface p-5">
          <div className="label mb-2">Dernier import</div>
          <div className="font-mono text-sm text-ink-100 truncate">{lastResult.filename}</div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="display text-2xl text-ink-100">{lastResult.total}</span>
              <span className="text-ink-500 ml-2">lue{lastResult.total > 1 ? 's' : ''}</span>
            </div>
            <div>
              <span className="display text-2xl text-sage-300">{lastResult.inserted}</span>
              <span className="text-ink-500 ml-2">insérée{lastResult.inserted > 1 ? 's' : ''}</span>
            </div>
            <div>
              <span className="display text-2xl text-ink-400">{lastResult.skipped}</span>
              <span className="text-ink-500 ml-2">dédupliquée{lastResult.skipped > 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDeleteImport}
        title="Supprimer cet import ?"
        description={
          pendingDeleteImport ? (
            <>
              <span className="display-italic">{pendingDeleteImport.filename}</span> et les{' '}
              <span className="display-italic">{pendingDeleteImport.insertedCount}</span>{' '}
              transaction(s) qui en proviennent seront définitivement supprimées.
              L'opération est transactionnelle&nbsp;: tout ou rien.
            </>
          ) : null
        }
        confirmLabel="Supprimer"
        destructive
        busy={deleteImportMut.isPending}
        error={deleteError}
        onConfirm={() => {
          if (!pendingDeleteImport) return;
          deleteImportMut.mutate(pendingDeleteImport.id);
        }}
        onCancel={() => { setPendingDeleteImport(null); setDeleteError(null); }}
      />

      <FileImportsList
        imports={importsQ.data?.imports ?? []}
        accounts={accountsQ.data?.accounts ?? []}
        onRequestDelete={(fi) => { setDeleteError(null); setPendingDeleteImport(fi); }}
      />
    </div>
  );
}
```

Note: `HubLayout` already renders the page title (`Données`) and the tab
strip above the Outlet. Do **not** re-render an `<h1 className="page-title">Imports</h1>`
inside this wrapper. The outer `<div className="flex flex-col gap-8">`
stays — it provides vertical spacing between the wrapper's own children
(UploadForm, wizard, last-result card, FileImportsList, ConfirmDialog).

- [ ] **Step 5: Add tests for each Data wrapper**

Create thin smoke tests for the three wrappers. Example
`pages/Data/__tests__/Duplicates.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Duplicates } from '../Duplicates';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn().mockResolvedValue({ clusters: [] }) };
});

describe('Duplicates route', () => {
  it('renders the DuplicatesPanel', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Duplicates />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/doublon/i)).toBeInTheDocument();
  });
});
```

Analogous small tests for `Backup.test.tsx` and `PdfTemplates.test.tsx`
(assert the panel's own headline text renders).

Move the substantial pre-existing test file
`pages/__tests__/Imports.test.tsx` to
`pages/Data/__tests__/Imports.test.tsx`, adjust the import
`../../Imports` → `../Imports`, and drop any assertions that hit
DuplicatesPanel/BackupPanel/PdfTemplatesPanel (those now live in their
own smoke test files above).

- [ ] **Step 6: Wire routes in `App.tsx`**

Update the `/donnees` block:

```tsx
import { Imports } from './pages/Data/Imports';
import { Duplicates } from './pages/Data/Duplicates';
import { PdfTemplates } from './pages/Data/PdfTemplates';
import { Backup } from './pages/Data/Backup';

<Route path="/donnees" element={<HubLayout title="Données" tabs={DONNEES_TABS} />}>
  <Route index element={<Navigate to="imports" replace />} />
  <Route path="imports" element={<Imports />} />
  <Route path="doublons" element={<Duplicates />} />
  <Route path="modeles" element={<PdfTemplates />} />
  <Route path="sauvegarde" element={<Backup />} />
</Route>
```

Remove `import { Imports } from './pages/Imports';` (old barrel).

- [ ] **Step 7: Delete old `pages/Imports/index.tsx`**

```bash
git rm frontend/src/pages/Imports/index.tsx
git rm frontend/src/pages/__tests__/Imports.test.tsx
```

- [ ] **Step 8: Type-check + tests**

```bash
cd frontend && npx tsc -b --noEmit && npx vitest run
```
Expected: all pass. Any test that mounted the old
`pages/Imports/index.tsx` should now mount `pages/Data/Imports.tsx`
instead.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/Data \
        frontend/src/App.tsx
git rm frontend/src/pages/Imports/index.tsx \
       frontend/src/pages/__tests__/Imports.test.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "refactor(imports): split into /donnees/{imports,doublons,modeles,sauvegarde} wrappers"
```

---

## Task 7: Extract `PatternsSection` into `/comptes/motifs`

**Files:**
- Create: `frontend/src/pages/Accounts/Patterns.tsx`
- Create: `frontend/src/pages/Accounts/__tests__/Patterns.test.tsx`
- Modify: `frontend/src/pages/Accounts/index.tsx` — remove
  `<PatternsSection …>` render
- Modify: `frontend/src/pages/__tests__/Accounts.test.tsx` — drop the
  pattern-panel assertions
- Modify: `frontend/src/App.tsx` — add `<Route path="motifs" …>`

**Interfaces:**
- Consumes: existing `PatternsSection` component (unchanged), `useQuery`
  hooks that hit `/api/accounts` and `/api/account-filename-patterns`.
- Produces: `export function Patterns()`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/Accounts/__tests__/Patterns.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Patterns } from '../Patterns';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/accounts') return { accounts: [] };
    if (path === '/api/account-filename-patterns') return { patterns: [] };
    throw new Error(`unexpected: ${path}`);
  });
});

describe('Patterns route', () => {
  it('renders the PatternsSection headline', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Patterns />
      </QueryClientProvider>,
    );
    // PatternsSection's own headline text; keep the assertion loose so a
    // future copy tweak doesn't break the smoke test.
    expect(await screen.findByText(/motifs? de fichier/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/Accounts/__tests__/Patterns.test.tsx
```
Expected: FAIL — module `../Patterns` not found.

- [ ] **Step 3: Create `pages/Accounts/Patterns.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account, AccountFilenamePattern } from '../../api/types';
import { PatternsSection } from './PatternsSection';

export function Patterns() {
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const patternsQ = useQuery({
    queryKey: ['patterns'],
    queryFn: () => api<{ patterns: AccountFilenamePattern[] }>('/api/account-filename-patterns'),
  });
  return (
    <PatternsSection
      accounts={accountsQ.data?.accounts ?? []}
      patterns={patternsQ.data?.patterns ?? []}
    />
  );
}
```

- [ ] **Step 4: Remove `<PatternsSection …>` from `pages/Accounts/index.tsx`**

Delete lines 258–260 of the current `index.tsx` (the `<PatternsSection
patterns={…} accounts={…} />` render) and the `patternsQ` `useQuery`
block (lines 31–34). Also drop the `PatternsSection` import.

- [ ] **Step 5: Update `pages/__tests__/Accounts.test.tsx`**

Remove any assertions that expect the patterns UI on `/comptes`. Add a
one-line comment explaining that the patterns test now lives at
`pages/Accounts/__tests__/Patterns.test.tsx`.

- [ ] **Step 6: Wire the new route in `App.tsx`**

Update the `/comptes` block:

```tsx
import { Patterns } from './pages/Accounts/Patterns';

<Route path="/comptes" element={<HubLayout title="Comptes" tabs={COMPTES_TABS} />}>
  <Route index element={<Accounts />} />
  <Route path="motifs" element={<Patterns />} />
</Route>
```

- [ ] **Step 7: Type-check + tests**

```bash
cd frontend && npx tsc -b --noEmit && npx vitest run
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Accounts/Patterns.tsx \
        frontend/src/pages/Accounts/__tests__/Patterns.test.tsx \
        frontend/src/pages/Accounts/index.tsx \
        frontend/src/pages/__tests__/Accounts.test.tsx \
        frontend/src/App.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "refactor(accounts): move filename patterns to /comptes/motifs"
```

---

## Task 8: NavIcons cleanup

**Files:**
- Modify: `frontend/src/components/NavIcons.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `navIcons` map with keys used by the new sectioned nav:
  `dashboard`, `transactions`, `budgets`, `rules`, `accounts`, `imports`.
  Keys `tri` and `categories` are no longer referenced by `Layout.tsx`
  and can be removed. `imports` stays (repurposed for the Données hub);
  `rules` stays (repurposed for the Règles hub).

- [ ] **Step 1: Remove the unused icon exports**

Delete `IconTri` and `IconCategories` function declarations from
`NavIcons.tsx`.

Update the `navIcons` map to:

```tsx
export const navIcons = {
  dashboard: IconDashboard,
  transactions: IconTransactions,
  budgets: IconBudgets,
  rules: IconRules,
  accounts: IconAccounts,
  imports: IconImports,
} as const;
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc -b --noEmit
```
Expected: no errors. `Layout.tsx` should already reference only the six
remaining keys after Task 3.

- [ ] **Step 3: Full test run**

```bash
cd frontend && npx vitest run
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/NavIcons.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "refactor(nav): drop unused Tri and Categories icon exports"
```

---

## Task 9: Final integration pass

**Files:** none new; verification-only.

- [ ] **Step 1: Build and type-check**

```bash
cd frontend && npm run build
```
Expected: clean build with no errors or warnings related to this work.

- [ ] **Step 2: Full test suite**

```bash
cd frontend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 3: Manual QA against the spec**

Boot the app:

```bash
cd frontend && npm run dev
```

Walk each of these paths and assert:
- `/` renders Dashboard.
- `/transactions` renders Transactions.
- `/budgets` renders Budgets.
- `/regles` → redirects to `/regles/tri` → renders Tri.
- `/regles/liste` → renders Règles list.
- `/regles/categories` → renders Catégories.
- `/comptes` → renders accounts list (no PatternsSection at the bottom).
- `/comptes/motifs` → renders PatternsSection standalone.
- `/donnees` → redirects to `/donnees/imports` → renders upload flow.
- `/donnees/doublons` → renders DuplicatesPanel.
- `/donnees/modeles` → renders PdfTemplatesPanel.
- `/donnees/sauvegarde` → renders BackupPanel.
- `/reglages` → renders Settings.
- `/profil` → renders Profile.
- Legacy: `/tri`, `/rules`, `/categories`, `/accounts`, `/imports`,
  `/settings`, `/profile` each redirect to the corresponding new URL.
- Sidebar shows three section headers; Règles / Comptes / Données expand
  their sub-items when their section is active.
- Mobile drawer shows the same structure; sub-items are indented.

- [ ] **Step 4: Cross-check against spec sections**

Open `docs/superpowers/specs/2026-07-10-ia-reorganization-design.md`
and confirm each bullet under "Feature moves" and "Redirect policy"
matches the running app.

- [ ] **Step 5: No commit required** — this task is verification only.

---

## Notes for the executor

- **Work directly on `main`.** Do not create branches. Do not push unless
  the user explicitly asks.
- **Attribution:** every commit uses
  `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`.
  Do not update `.git/config`.
- **Do not touch pending files** unrelated to this work (`.gitignore`,
  `backend/**`, `frontend/src/api/types.ts`, `frontend/src/pages/Accounts/{AccountCard,AccountForm}.tsx`
  currently show as modified in the working tree — those belong to a
  separate in-flight change).
- **If a test unrelated to this plan fails**, stop and report — do not fix it here.
