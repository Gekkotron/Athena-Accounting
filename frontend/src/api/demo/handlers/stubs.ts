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
  registerHandler('POST',   '/api/imports', stub);
  registerHandler('POST',   '/api/imports/pdf', stub);
  registerHandler('POST',   '/api/imports/photo', stub);
  registerHandler('POST',   '/api/imports/pdf/templates', stub);
  registerHandler('POST',   '/api/imports/pdf/templates/preview', stub);
  registerHandler('GET',    '/api/imports/pdf/drafts/:id', stub);
  registerHandler('GET',    '/api/imports/pdf/drafts/:id/ocr-status', stub);

  // PDF templates CRUD.
  registerHandler('GET',    '/api/pdf-templates', stub);
  registerHandler('POST',   '/api/pdf-templates', stub);
  registerHandler('PUT',    '/api/pdf-templates/:id', stub);
  registerHandler('DELETE', '/api/pdf-templates/:id', stub);

  // MCP settings — token generation needs a real server; read stubs
  // let the settings page render "disabled" without a raw error.
  registerHandler('GET',    '/api/settings/mcp', () => ({ enabled: false, hasToken: false }));
  registerHandler('PUT',    '/api/settings/mcp', stub);
  registerHandler('POST',   '/api/settings/mcp/token', stub);
  registerHandler('DELETE', '/api/settings/mcp/token', stub);
}
