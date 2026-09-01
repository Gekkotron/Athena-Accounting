import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Notifications } from '../index';
import { pinLocale } from '../../../test/i18n';
import type { Notification } from '../../../../../shared/api-contracts.js';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

pinLocale('notifications');

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    kind: 'big_transaction',
    payload: { kind: 'test' },
    title: 'Grosse transaction',
    body: '120,00 € chez Carrefour',
    readAt: null,
    createdAt: '2026-09-01T09:00:00Z',
    ...overrides,
  };
}

function mockApi(items: Notification[]) {
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/notifications') return { items, nextCursor: null };
    if (path === '/api/notifications/read-all') return undefined;
    if (/^\/api\/notifications\/\d+\/read$/.test(path)) return undefined;
    if (/^\/api\/notifications\/\d+$/.test(path)) return undefined;
    void init;
    return { ok: true };
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  mockApi([]);
});

describe('Notifications inbox page', () => {
  it('renders the empty state when there are no notifications', async () => {
    mockApi([]);
    renderPage();
    expect(await screen.findByText('Aucune notification')).toBeInTheDocument();
  });

  it('groups two notifications on the same day into one group', async () => {
    mockApi([
      makeNotification({ id: 1, createdAt: '2026-09-01T09:00:00Z' }),
      makeNotification({ id: 2, createdAt: '2026-09-01T08:00:00Z' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('notification-row')).toHaveLength(2));
    expect(screen.getAllByTestId('notification-group-header')).toHaveLength(1);
  });

  it('splits two notifications on different days into two groups', async () => {
    mockApi([
      makeNotification({ id: 1, createdAt: '2026-09-01T09:00:00Z' }),
      makeNotification({ id: 2, createdAt: '2026-08-20T09:00:00Z' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('notification-row')).toHaveLength(2));
    expect(screen.getAllByTestId('notification-group-header')).toHaveLength(2);
  });

  it('changes the inbox query when a filter chip is clicked', async () => {
    mockApi([makeNotification()]);
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('notification-row')).toHaveLength(1));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Enveloppe' }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/api/notifications',
        expect.objectContaining({ query: expect.objectContaining({ kind: 'envelope_exceeded' }) }),
      );
    });
  });

  it('calls the mark-all-read mutation when the button is clicked', async () => {
    mockApi([makeNotification()]);
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('notification-row')).toHaveLength(1));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tout marquer comme lu' }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/api/notifications/read-all',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
