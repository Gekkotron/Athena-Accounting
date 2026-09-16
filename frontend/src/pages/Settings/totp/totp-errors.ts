import { ApiError } from '../../../api/client';

// Maps the backend's small, well-defined error surface for /api/auth/2fa/*
// onto the four i18n keys the modals render. The backend uses 401 for both
// wrong-password and invalid-code (deliberately timing-stable), so callers
// pass which flavour they expect via `context` to pick the right label.
export function describeTotpError(
  err: unknown,
  t: (key: string) => string,
  context: 'password' | 'code' | 'either',
): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t('settings.twoFactor.errors.rateLimited');
    if (err.status === 401) {
      if (context === 'password') return t('settings.twoFactor.errors.wrongPassword');
      if (context === 'code') return t('settings.twoFactor.errors.invalidCode');
      return t('settings.twoFactor.errors.wrongPassword');
    }
  }
  return t('settings.twoFactor.errors.generic');
}
