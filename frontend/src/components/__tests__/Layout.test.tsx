import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from '../Layout';
import { PrivacyProvider } from '../../contexts/PrivacyContext';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

const user = { id: 1, username: 'julien' };

function renderLayout(initialEntries: string[] = ['/']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <PrivacyProvider>
          <Layout user={user} />
        </PrivacyProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('Layout', () => {
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
    // The Règles hub expands its sub-nav only while the current route is
    // inside it — render on a /regles/* route to exercise that.
    renderLayout(['/regles/tri']);
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

  it('renders the user card with the username link to /profile', () => {
    renderLayout();
    const link = screen.getByRole('link', { name: user.username });
    expect(link).toHaveAttribute('href', '/profile');
  });

  it('logout POSTs to /api/auth/logout', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const u = userEvent.setup();
    renderLayout();
    await u.click(screen.getByRole('button', { name: /se déconnecter/i }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' }));
  });

  it('privacy toggle button label reflects the current state', async () => {
    const u = userEvent.setup();
    renderLayout();
    // Initially: not hidden → button says "Masquer".
    const toggle = screen.getByRole('button', { name: /masquer les montants/i });
    await u.click(toggle);
    // After click, both the mobile and desktop toggles say "Afficher".
    expect(screen.getAllByRole('button', { name: /afficher les montants/i }).length).toBeGreaterThan(0);
  });

  it('mobile drawer opens on menu tap and closes on ✕', async () => {
    // Mobile drawer is gated by `md:hidden` — jsdom doesn't apply media
    // queries but the mobile toggle button is always in the DOM.
    const u = userEvent.setup();
    renderLayout();
    const menuBtn = screen.getByRole('button', { name: /^menu$/i });
    await u.click(menuBtn);
    // Drawer's Fermer button now visible.
    const closeBtn = await screen.findByRole('button', { name: /fermer/i });
    await u.click(closeBtn);
    // After close, the Fermer button unmounts.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /fermer/i })).not.toBeInTheDocument(),
    );
  });

  it('exposes a Réglages link to /reglages from the sidebar user card', () => {
    renderLayout();
    const link = screen.getByRole('link', { name: /réglages/i });
    expect(link).toHaveAttribute('href', '/reglages');
  });
});
