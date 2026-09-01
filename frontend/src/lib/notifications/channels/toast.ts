import type { Notification } from '../../../../../shared/api-contracts.js';
import { renderBody, renderTitle } from '../render-client.js';

type Privacy = { hideAmount: boolean; hideMerchant: boolean };

// Pure — no hooks, so it can be called from a plain callback (App.tsx's SSE
// effect) instead of a component. Callers obtain `push` via useToast() at
// their own component's top level and close over it.
//
// `n.title`/`n.body` are the server's full-detail render (renderFullDetail)
// and must not be used directly here — re-render locally against `privacy`,
// same as the webPush channel, so the toast honors the privacy toggle too.
export function showToast(push: (t: { title: string; body: string }) => void, n: Notification, privacy: Privacy): void {
  push({ title: renderTitle(n.payload, privacy), body: renderBody(n.payload, privacy) });
}
