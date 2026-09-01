import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../../../components/Toast';
import { showToast } from '../channels/toast.js';
import { renderBody, renderTitle } from '../render-client.js';
import type { Notification } from '../../../../../shared/api-contracts.js';

const OPEN_PRIVACY = { hideAmount: false, hideMerchant: false };
const HIDDEN_PRIVACY = { hideAmount: true, hideMerchant: true };

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    kind: 'big_transaction',
    payload: { kind: 'big_transaction', single: { txId: 1, accountId: 2, amount: 120, merchant: 'Carrefour' } },
    title: 'Big transaction',
    body: '120,00 € at Carrefour',
    readAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

// Renders a bare host that exposes `push` via a button so the test can drive
// it the same way the App.tsx `NotificationsBridge` would.
function Host({ n, privacy }: { n: Notification; privacy: { hideAmount: boolean; hideMerchant: boolean } }) {
  const { push } = useToast();
  return <button onClick={() => showToast(push, n, privacy)}>fire</button>;
}

describe('ToastProvider host', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders a pushed toast and auto-dismisses it after 5s', () => {
    const n = makeNotification();
    const expectedTitle = renderTitle(n.payload, OPEN_PRIVACY);
    const expectedBody = renderBody(n.payload, OPEN_PRIVACY);
    render(
      <ToastProvider>
        <Host n={n} privacy={OPEN_PRIVACY} />
      </ToastProvider>,
    );

    act(() => { screen.getByText('fire').click(); });

    // The default normalizer collapses the currency string's non-breaking
    // space to a plain space before comparing, so match literally instead —
    // otherwise the raw `expectedBody` (with its non-breaking space) never
    // equals the normalized DOM text.
    const exact = { normalizer: (s: string) => s };
    expect(screen.getByText(expectedTitle)).toBeInTheDocument();
    expect(screen.getByText(expectedBody, exact)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(5000); });

    expect(screen.queryByText(expectedTitle)).not.toBeInTheDocument();
  });
});

describe('showToast adapter', () => {
  it('calls the push callback with the privacy-rendered title and body', () => {
    const push = vi.fn();
    const n = makeNotification();

    showToast(push, n, OPEN_PRIVACY);

    expect(push).toHaveBeenCalledWith({
      title: renderTitle(n.payload, OPEN_PRIVACY),
      body: renderBody(n.payload, OPEN_PRIVACY),
    });
  });

  it('redacts amount and merchant from the pushed body when privacy is on', () => {
    const push = vi.fn();
    const n = makeNotification();

    showToast(push, n, HIDDEN_PRIVACY);

    const pushedBody = push.mock.calls[0]![0].body as string;
    expect(pushedBody).not.toMatch(/€/);
    expect(pushedBody).not.toMatch(/Carrefour/);
  });
});
