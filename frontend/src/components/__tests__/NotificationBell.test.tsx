import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NotificationBell } from '../NotificationBell';
import { pinLocale } from '../../test/i18n';
import type { Notification } from '../../../../shared/api-contracts.js';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../api/client';
const apiMock = vi.mocked(api);

pinLocale('layout');

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    kind: 'test',
    payload: { kind: 'test' },
    title: 'Big transaction',
    body: '120,00 € at Carrefour',
    readAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function mockApi(count: number, items: Notification[]) {
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/notifications/unread-count') return { count };
    if (path === '/api/notifications') return { items, nextCursor: null };
    if (/^\/api\/notifications\/\d+\/read$/.test(path)) return undefined;
    void init;
    return { ok: true };
  });
}

function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  mockApi(0, []);
});

describe('NotificationBell', () => {
  it('shows the unread count on the badge', async () => {
    mockApi(3, [makeNotification()]);
    renderBell();
    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('3');
  });

  it('hides the badge entirely when the unread count is 0', async () => {
    mockApi(0, []);
    renderBell();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/notifications/unread-count'));
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('opens the popover on click and lists unread items', async () => {
    mockApi(1, [makeNotification()]);
    renderBell();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('Big transaction')).toBeInTheDocument();
  });

  it('marks the row as read with the right id on click', async () => {
    mockApi(1, [makeNotification({ id: 42 })]);
    renderBell();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    const row = await screen.findByText('Big transaction');
    await user.click(row);
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/api/notifications/42/read',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
