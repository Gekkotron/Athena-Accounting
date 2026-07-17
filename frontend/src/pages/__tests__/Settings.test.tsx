import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '../Settings';
import { DEFAULTS } from '../../lib/settings';
import { withTips } from '../../test/renderWithProviders';
import { pinLocale } from '../../test/i18n';

// Settings renders French strings by default (the app's current UI
// language). Preload 'settings' and 'common' for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the existing French-literal assertions below keep matching
// real rendered text.
pinLocale('settings', 'charts');

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {withTips(<Settings />)}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { apiMock.mockReset(); });

describe('Settings page', () => {
  it('renders a skeleton while the settings query is pending', async () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByTestId('settings-skeleton')).toBeInTheDocument();
  });

  it('clicking a range in the picker sends a PATCH with the new range', async () => {
    const calls: Array<{ path: string; init: any }> = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      calls.push({ path, init });
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/settings' && (!init || init.method !== 'PATCH')) return { settings: DEFAULTS };
      if (path === '/api/settings' && init?.method === 'PATCH') {
        return { settings: { ...DEFAULTS, ...init.json } };
      }
      throw new Error(`unexpected: ${init?.method ?? 'GET'} ${path}`);
    });
    const u = userEvent.setup();
    renderPage();
    // Wait for the skeleton to disappear.
    await waitFor(() => expect(screen.queryByTestId('settings-skeleton')).toBeNull());
    await u.click(screen.getByRole('button', { name: /^6 m$/i }));
    await waitFor(() => {
      const patch = calls.find((c) => c.init?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(patch!.init.json).toEqual({ dashboardRange: '6m' });
    });
  });

  it('number inputs commit on blur, not on every keystroke', async () => {
    const patchCalls: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/settings' && init?.method === 'PATCH') {
        patchCalls.push(init.json);
        return { settings: { ...DEFAULTS, ...init.json } };
      }
      if (path === '/api/settings') return { settings: DEFAULTS };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByTestId('settings-skeleton')).toBeNull());
    const gap = screen.getByLabelText(/seuil de ligne pointillée/i);
    await u.clear(gap);
    await u.type(gap, '12');
    // No PATCH yet — still focused.
    expect(patchCalls).toHaveLength(0);
    await u.tab();
    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]).toEqual({ chartGapThresholdDays: 12 });
  });

  it('"Réinitialiser" confirms then sends a PATCH with every default', async () => {
    const patchCalls: any[] = [];
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/settings' && init?.method === 'PATCH') {
        patchCalls.push(init.json);
        return { settings: DEFAULTS };
      }
      if (path === '/api/settings') return { settings: { ...DEFAULTS, dashboardRange: '12m' } };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByTestId('settings-skeleton')).toBeNull());
    await u.click(screen.getByRole('button', { name: /réinitialiser/i }));
    // ConfirmDialog opens; click the confirm button (labelled "Confirmer" in
    // the existing component — adjust if the shared component uses a
    // different label).
    await u.click(await screen.findByRole('button', { name: /^confirmer$/i }));
    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]).toEqual(DEFAULTS);
  });

  it('does not leave the "Enregistré" chip visible when the PATCH fails', async () => {
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === '/api/accounts') return { accounts: [] };
      if (path === '/api/settings' && init?.method === 'PATCH') {
        throw new Error('boom');
      }
      if (path === '/api/settings') return { settings: DEFAULTS };
      throw new Error(`unexpected: ${path}`);
    });
    const u = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByTestId('settings-skeleton')).toBeNull());
    await u.click(screen.getByRole('button', { name: /^6 m$/i }));
    await waitFor(() =>
      expect(screen.getByText(/impossible d'enregistrer les réglages/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/enregistré/i)).toBeNull();
  });
});
