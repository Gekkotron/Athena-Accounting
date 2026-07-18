import type { TFunction } from 'i18next';
import { ApiError } from './client';

/**
 * Map a caught error to a locale-appropriate message.
 *
 * Strategy: if the backend returned a machine `code`, prefer a translated
 * frontend string keyed by that code. `needs_template` additionally has a
 * `reason` field that discriminates between three concrete failure modes.
 * Falls back to `err.message` (backend English text) for unknown codes and
 * to a generic error string for non-Error values.
 *
 * Two call-site shapes are recognized:
 *  - `ApiError` (thrown by `api()`/`apiUpload()` in ./client) — `code`/`reason`
 *    live under `err.data`.
 *  - A plain `Error` with `code` (and sometimes `reason`) attached directly —
 *    this is how the PDF-import endpoints actually surface errors today:
 *    api/pdf-templates.ts issues raw `fetch()` calls and throws
 *    `Object.assign(new Error(text), { code, status, detail })` instead of
 *    going through the shared ApiError wrapper.
 */
function extractCodeAndReason(err: unknown): { code: string | null; reason: string | null } {
  if (err instanceof ApiError && err.data && typeof err.data === 'object') {
    const data = err.data as { code?: unknown; reason?: unknown };
    return {
      code: typeof data.code === 'string' ? data.code : null,
      reason: typeof data.reason === 'string' ? data.reason : null,
    };
  }
  if (err instanceof Error) {
    const withCode = err as Error & { code?: unknown; reason?: unknown };
    return {
      code: typeof withCode.code === 'string' ? withCode.code : null,
      reason: typeof withCode.reason === 'string' ? withCode.reason : null,
    };
  }
  return { code: null, reason: null };
}

// True when the error is one of the browser-only demo's "not
// available" stubs OR a missing-handler miss (any /api/* path we
// haven't taught the demo adapter about). Callers can gate a
// friendlier UI on this; errorMessage() itself already returns the
// French copy for us.
//
// Two shapes are recognized — same rationale as extractCodeAndReason
// above: `api()` throws ApiError with the demo flags under `err.data`,
// while raw-fetch call sites (api/pdf-templates.ts) rebuild a plain
// Error and carry the flags as own properties.
export function isDemoStubError(err: unknown): boolean {
  if (err instanceof ApiError && err.data && typeof err.data === 'object') {
    const d = err.data as { demoStub?: unknown; demoMissingHandler?: unknown };
    return d.demoStub === true || d.demoMissingHandler === true;
  }
  if (err instanceof Error) {
    const e = err as Error & { demoStub?: unknown; demoMissingHandler?: unknown };
    return e.demoStub === true || e.demoMissingHandler === true;
  }
  return false;
}

export function errorMessage(err: unknown, t: TFunction): string {
  if (isDemoStubError(err)) {
    return "Cette fonctionnalité n'est pas disponible dans la démo. Installez Athena pour l'utiliser.";
  }
  const { code, reason } = extractCodeAndReason(err);
  switch (code) {
    case 'pdf_encrypted':
      return t('errors.pdfEncrypted', { ns: 'imports' });
    case 'pdf_too_large':
      return t('errors.pdfTooLarge', { ns: 'imports' });
    case 'draft_expired':
      return t('errors.draftExpired', { ns: 'imports' });
    case 'template_yielded_no_rows':
      return t('errors.templateYieldedNoRows', { ns: 'imports' });
    case 'needs_template': {
      const reasonKey =
        reason === 'no_text_layer' ? 'noTextLayer' :
        reason === 'no_template' ? 'noTemplate' :
        reason === 'template_stale' ? 'templateStale' :
        'default';
      return t(`errors.needsTemplate.${reasonKey}`, { ns: 'imports' });
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return t('error', { ns: 'common' });
}
