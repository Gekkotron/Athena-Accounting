import type { Notification as N } from '../../../../../shared/api-contracts.js';
import { renderBody, renderTitle } from '../render-client.js';

export function sendWebPush(n: N, prefs: { hideAmount: boolean; hideMerchant: boolean }): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  new Notification(renderTitle(n.payload, prefs), {
    body: renderBody(n.payload, prefs),
    tag: `athena-${n.id}`,
  });
}

export function requestWebPushPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return Promise.resolve('denied');
  return Notification.requestPermission();
}
