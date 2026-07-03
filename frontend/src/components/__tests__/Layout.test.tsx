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

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PrivacyProvider>
          <Layout user={user} />
        </PrivacyProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('Layout', () => {
  it('renders every nav link', () => {
    renderLayout();
    // Nav labels — some appear twice (mobile drawer + desktop sidebar) but
    // we only assert presence.
    for (const label of ['Dashboard', 'Transactions', 'Tri', 'Catégories', 'Règles', 'Comptes', 'Imports / Sauvegarde']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
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

  it('exposes a Réglages link to /settings from the sidebar user card', () => {
    renderLayout();
    const link = screen.getByRole('link', { name: /réglages/i });
    expect(link).toHaveAttribute('href', '/settings');
  });
});
