import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderBody, renderTitle } from '../render-client.js';
import type { Notification } from '../../../../../shared/api-contracts.js';

const PRIVACY = { hideAmount: true, hideMerchant: true };

const sendNotification = vi.fn();
const isPermissionGranted = vi.fn();
const requestPermission = vi.fn();

vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  isPermissionGranted: () => isPermissionGranted(),
  requestPermission: () => requestPermission(),
}));

const globalWithTauri = globalThis as unknown as { window?: { __TAURI__?: unknown } };

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

describe('sendOsNotification', () => {
  beforeEach(() => {
    sendNotification.mockReset();
    isPermissionGranted.mockReset().mockResolvedValue(true);
    requestPermission.mockReset().mockResolvedValue('granted');
  });

  afterEach(() => {
    delete globalWithTauri.window;
  });

  it('no-ops when window.__TAURI__ is undefined (running in a plain browser)', async () => {
    globalWithTauri.window = {};
    const { sendOsNotification } = await import('../channels/osNative.js');
    await sendOsNotification(makeNotification(), PRIVACY);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(isPermissionGranted).not.toHaveBeenCalled();
  });

  it('requests permission and skips send when the user denies it', async () => {
    globalWithTauri.window = { __TAURI__: {} };
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue('denied');
    const { sendOsNotification } = await import('../channels/osNative.js');
    await sendOsNotification(makeNotification(), PRIVACY);
    expect(requestPermission).toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('fires sendNotification with the redacted title/body when permission is granted', async () => {
    globalWithTauri.window = { __TAURI__: {} };
    const n = makeNotification();
    const { sendOsNotification } = await import('../channels/osNative.js');
    await sendOsNotification(n, PRIVACY);

    const expectedTitle = renderTitle(n.payload, PRIVACY);
    const expectedBody = renderBody(n.payload, PRIVACY);

    expect(expectedBody).not.toMatch(/€/);
    expect(expectedBody).not.toMatch(/Carrefour/);

    expect(sendNotification).toHaveBeenCalledWith({ title: expectedTitle, body: expectedBody });
  });
});
