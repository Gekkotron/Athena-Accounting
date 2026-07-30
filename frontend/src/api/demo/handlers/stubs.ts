// Stubbed endpoints — features that need a real backend to work.
// Every stub throws an ApiError with { demoStub: true } so the shared
// errorMessage helper can render the "not available" French copy.

import { ApiError } from '../../apiError';
import { registerHandler } from '../index';

const DEMO_MSG = "Cette fonctionnalité n'est pas disponible dans la démo. Installez Athena pour l'utiliser.";

function stub(_req: unknown): never {
  throw new ApiError(DEMO_MSG, 501, { demoStub: true });
}

export function registerStubHandlers(): void {
  // File imports (multipart also stubbed via apiUpload in index.ts).
  registerHandler('GET',    '/api/imports', stub);
  registerHandler('GET',    '/api/imports/:id', stub);
  registerHandler('DELETE', '/api/imports/:id', stub);
  registerHandler('POST',   '/api/imports', stub);
  registerHandler('POST',   '/api/imports/preview', stub);
  registerHandler('POST',   '/api/imports/pdf', stub);
  registerHandler('POST',   '/api/imports/photo', stub);
  registerHandler('POST',   '/api/imports/pdf/templates', stub);
  registerHandler('POST',   '/api/imports/pdf/templates/preview', stub);
  registerHandler('GET',    '/api/imports/pdf/drafts/:id', stub);
  registerHandler('GET',    '/api/imports/pdf/drafts/:id/ocr-status', stub);

  // Envelopes (Budgets → Enveloppes) — the report joins across
  // transactions/categories/settings with SQL that has no demo
  // equivalent. Stub the whole surface uniformly.
  registerHandler('GET',    '/api/envelopes/report', stub);
  registerHandler('GET',    '/api/envelopes/categories', stub);
  registerHandler('POST',   '/api/envelopes/categories', stub);
  registerHandler('PUT',    '/api/envelopes/categories/:categoryId', stub);
  registerHandler('DELETE', '/api/envelopes/categories/:categoryId', stub);
  registerHandler('GET',    '/api/envelopes/assignments', stub);
  registerHandler('POST',   '/api/envelopes/assignments', stub);
  registerHandler('GET',    '/api/envelopes/holds', stub);
  registerHandler('POST',   '/api/envelopes/holds', stub);
  registerHandler('POST',   '/api/envelopes/reallocate', stub);

  // PDF templates CRUD.
  registerHandler('GET',    '/api/pdf-templates', stub);
  registerHandler('POST',   '/api/pdf-templates', stub);
  registerHandler('PUT',    '/api/pdf-templates/:id', stub);
  registerHandler('DELETE', '/api/pdf-templates/:id', stub);

  // Duplicates panel — the SQL grouping is real-backend-only. Stubbing
  // (rather than leaving the missing-handler fallback) lets the frontend
  // detect demoStub and render the dedicated section instead of a raw
  // error string.
  registerHandler('GET',    '/api/transactions/duplicates', stub);
  registerHandler('POST',   '/api/transactions/mark-not-duplicate', stub);
  registerHandler('POST',   '/api/transactions/delete-bulk', stub);

  // Encryption at rest — the demo has no real PGlite datadir to snapshot.
  // The GET read stub reports the always-unencrypted, nothing-pending state
  // so Settings → Security renders the "Enable encryption" form harmlessly;
  // the mutating routes aren't stubbed, so submitting it falls through to
  // the generic missing-handler error.
  registerHandler('GET',    '/api/security', () => ({
    driver: 'pglite', encrypted: false, pendingDisable: false,
  }));

  // MCP settings — token generation needs a real server; read stubs
  // let the settings page render "disabled" without a raw error.
  registerHandler('GET',    '/api/settings/mcp', () => ({ enabled: false, hasToken: false }));
  registerHandler('PUT',    '/api/settings/mcp', stub);
  registerHandler('POST',   '/api/settings/mcp/token', stub);
  registerHandler('DELETE', '/api/settings/mcp/token', stub);

  // Bank sync (Enable Banking connector) — needs a real backend and per-user
  // API credentials. Read stubs report the unconfigured state so the settings
  // section renders its explanatory form harmlessly; every mutation is a
  // proper demoStub 501.
  registerHandler('GET',    '/api/bank-sync/status', () => ({ configured: false, applicationId: null }));
  registerHandler('GET',    '/api/bank-sync/connections', () => ({ connections: [] }));
  registerHandler('GET',    '/api/bank-sync/aspsps', stub);
  registerHandler('PUT',    '/api/bank-sync/credentials', stub);
  registerHandler('DELETE', '/api/bank-sync/credentials', stub);
  registerHandler('POST',   '/api/bank-sync/connect', stub);
  registerHandler('POST',   '/api/bank-sync/sessions', stub);
  registerHandler('POST',   '/api/bank-sync/sync', stub);

  // Tips (per-page guided tours) — TipsContext posts to these on every
  // dismissal and rolls back optimistically on failure, so a plain 501
  // would keep the tour's popover stuck open. Storing dismissals
  // in an in-memory Map is enough for session-scoped UX without touching
  // the persisted DemoState — a page reload replays the tour, which is
  // the intended behavior in a demo.
  const dismissedTips = new Map<string, string>();
  registerHandler('GET',  '/api/tips/dismissed', () => ({
    dismissed: Object.fromEntries(dismissedTips),
  }));
  registerHandler('POST', '/api/tips/dismiss', (req) => {
    const id = (req.body as { id?: string } | null)?.id;
    if (id) dismissedTips.set(id, new Date().toISOString());
    return { ok: true };
  });
  registerHandler('POST', '/api/tips/undismiss', (req) => {
    const id = (req.body as { id?: string } | null)?.id;
    if (id) dismissedTips.delete(id);
    return { ok: true };
  });
  registerHandler('POST', '/api/tips/reset', () => {
    dismissedTips.clear();
    return { ok: true };
  });
}
