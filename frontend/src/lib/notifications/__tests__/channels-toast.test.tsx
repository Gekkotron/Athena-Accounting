import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../../../components/Toast';
import { showToast } from '../channels/toast.js';
import type { Notification } from '../../../../../shared/api-contracts.js';

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

// Renders a bare host that exposes `push` via a button so the test can drive
// it the same way the App.tsx `NotificationsBridge` would.
function Host({ n }: { n: Notification }) {
  const { push } = useToast();
  return <button onClick={() => showToast(push, n)}>fire</button>;
}

describe('ToastProvider host', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders a pushed toast and auto-dismisses it after 5s', () => {
    const n = makeNotification();
    render(
      <ToastProvider>
        <Host n={n} />
      </ToastProvider>,
    );

    act(() => { screen.getByText('fire').click(); });

    expect(screen.getByText('Big transaction')).toBeInTheDocument();
    expect(screen.getByText('120,00 € at Carrefour')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(5000); });

    expect(screen.queryByText('Big transaction')).not.toBeInTheDocument();
  });
});

describe('showToast adapter', () => {
  it('calls the push callback with the notification title and body', () => {
    const push = vi.fn();
    const n = makeNotification({ title: 'Solde bas', body: 'Compte Courant < 50 €' });

    showToast(push, n);

    expect(push).toHaveBeenCalledWith({ title: 'Solde bas', body: 'Compte Courant < 50 €' });
  });
});
