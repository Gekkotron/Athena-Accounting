import type { Notification } from '../../../../shared/api-contracts.js';

export function startNotificationsStream(onEvent: (n: Notification) => void): () => void {
  // jsdom (frontend unit tests) has no EventSource global — fail closed
  // instead of throwing out of the mount effect.
  if (typeof EventSource === 'undefined') return () => {};
  const es = new EventSource('/api/notifications/stream', { withCredentials: true });
  es.onmessage = (ev) => {
    try { onEvent(JSON.parse(ev.data)); } catch { /* ignore malformed frame */ }
  };
  return () => es.close();
}
