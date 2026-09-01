import type { Notification } from '../../../../../shared/api-contracts.js';

// Pure — no hooks, so it can be called from a plain callback (App.tsx's SSE
// effect) instead of a component. Callers obtain `push` via useToast() at
// their own component's top level and close over it.
export function showToast(push: (t: { title: string; body: string }) => void, n: Notification): void {
  push({ title: n.title, body: n.body });
}
