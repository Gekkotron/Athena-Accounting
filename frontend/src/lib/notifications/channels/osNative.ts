import type { Notification } from '../../../../../shared/api-contracts.js';
import { renderBody, renderTitle } from '../render-client.js';

type Privacy = { hideAmount: boolean; hideMerchant: boolean };

// Adapter for the Tauri OS-native notification channel. No-op outside a
// Tauri shell (plain browser, Docker path, jsdom in tests) so the same
// bundle ships both places. The plugin module is imported dynamically so
// Vite doesn't try to resolve `@tauri-apps/plugin-notification` when the
// frontend is built for the non-Tauri path.
export async function sendOsNotification(n: Notification, privacy: Privacy): Promise<void> {
  const w = (globalThis as { window?: { __TAURI__?: unknown } }).window;
  if (!w?.__TAURI__) return;
  const { sendNotification, isPermissionGranted, requestPermission } =
    await import('@tauri-apps/plugin-notification');
  if (!(await isPermissionGranted()) && (await requestPermission()) !== 'granted') return;
  await sendNotification({
    title: renderTitle(n.payload, privacy),
    body: renderBody(n.payload, privacy),
  });
}
