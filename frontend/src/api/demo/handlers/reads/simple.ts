import type { Budget, Category, Rule } from '../../../types';
import { DEFAULTS } from '../../../../lib/settings';
import { getState } from '../../store';
import { registerHandler } from '../../index';

export function registerSimpleHandlers(): void {
  registerHandler('GET', '/api/auth/me', () => ({ user: { id: 1, username: 'Démo' } }));
  // mode: 'session' keeps the SettingsLock card hidden in the demo, and
  // lockConfigured: false disarms the idle timer and hides the eye button —
  // both without any component special-casing (see LockContext).
  registerHandler('GET', '/api/auth/lock-status', () => ({ mode: 'session', lockConfigured: false }));
  registerHandler('GET', '/api/onboarding/status', () => ({ needsOnboarding: false }));
  registerHandler('GET', '/health', () => ({ ok: true, mode: 'demo' as const }));
  registerHandler('GET', '/api/categories', () => ({ categories: getState().categories as Category[] }));
  registerHandler('GET', '/api/rules', () => ({ rules: getState().rules as Rule[] }));
  registerHandler('GET', '/api/budgets', () => ({ budgets: getState().budgets as Budget[] }));
  // Mirrors the backend settings route: stored values over defaults, so a
  // partial demo seed never leaves consumers with undefined standard keys
  // (e.g. dashboardChartScope, which scopes the Évolution chart).
  registerHandler('GET', '/api/settings', () => ({ settings: { ...DEFAULTS, ...getState().settings } }));
  // Sauvegarde distante: plausible fake status that round-trips the demo
  // write handlers (writes/settings.ts). Secrets are never stored.
  registerHandler('GET', '/api/backup/destination', () => {
    const dest = getState().backupDestination;
    const auto = { enabled: true, hour: 3, nextAt: null as string | null };
    return dest ? { configured: true, ...dest, auto } : { configured: false, auto };
  });
}
