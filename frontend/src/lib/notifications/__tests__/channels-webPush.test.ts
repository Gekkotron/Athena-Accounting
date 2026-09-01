import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendWebPush, requestWebPushPermission } from '../channels/webPush.js';
import { renderBody, renderTitle } from '../render-client.js';
import type { Notification } from '../../../../../shared/api-contracts.js';

const PRIVACY = { hideAmount: true, hideMerchant: true };

// jsdom doesn't implement the Notification API, so the adapter's globals are
// stubbed directly on globalThis for the duration of each test.
const globalWithMocks = globalThis as unknown as { Notification?: unknown; window?: unknown };

function makeNotification(): Notification {
  return {
    id: 7,
    kind: 'big_transaction',
    payload: { kind: 'big_transaction', single: { txId: 1, accountId: 2, amount: 120, merchant: 'Carrefour' } },
    title: 'Big transaction',
    body: '120,00 € at Carrefour',
    readAt: null,
    createdAt: '2026-09-01T00:00:00Z',
  };
}

describe('sendWebPush', () => {
  let ctor: ReturnType<typeof vi.fn>;
  let permission: NotificationPermission;

  beforeEach(() => {
    ctor = vi.fn();
    permission = 'granted';
    globalWithMocks.window = globalThis;
    class FakeNotification {
      static requestPermission = vi.fn();
      static get permission() { return permission; }
      constructor(...args: unknown[]) { ctor(...args); }
    }
    globalWithMocks.Notification = FakeNotification;
  });

  afterEach(() => {
    delete globalWithMocks.Notification;
  });

  it('no-ops when permission is denied', () => {
    permission = 'denied';
    sendWebPush(makeNotification(), PRIVACY);
    expect(ctor).not.toHaveBeenCalled();
  });

  it('fires new Notification with redacted title/body and a dedup tag when granted', () => {
    const n = makeNotification();
    sendWebPush(n, PRIVACY);

    const expectedTitle = renderTitle(n.payload, PRIVACY);
    const expectedBody = renderBody(n.payload, PRIVACY);

    // Redaction actually took effect: hideAmount/hideMerchant strip the
    // currency and merchant name that a non-redacted render would include.
    expect(expectedBody).not.toMatch(/€/);
    expect(expectedBody).not.toMatch(/Carrefour/);

    expect(ctor).toHaveBeenCalledWith(expectedTitle, { body: expectedBody, tag: `athena-${n.id}` });
  });
});

describe('requestWebPushPermission', () => {
  afterEach(() => {
    delete globalWithMocks.Notification;
  });

  it('calls the browser permission API and returns its result', async () => {
    globalWithMocks.window = globalThis;
    const requestPermission = vi.fn().mockResolvedValue('granted');
    globalWithMocks.Notification = { requestPermission };

    const result = await requestWebPushPermission();

    expect(requestPermission).toHaveBeenCalled();
    expect(result).toBe('granted');
  });
});
