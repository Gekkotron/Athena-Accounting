import type { Budget, Category, Rule, TransferRule } from '../../../types';
import { getState } from '../../store';
import { registerHandler } from '../../index';

export function registerSimpleHandlers(): void {
  registerHandler('GET', '/api/auth/me', () => ({ user: { id: 1, username: 'Démo' } }));
  registerHandler('GET', '/api/onboarding/status', () => ({ needsOnboarding: false }));
  registerHandler('GET', '/health', () => ({ ok: true, mode: 'demo' as const }));
  registerHandler('GET', '/api/categories', () => ({ categories: getState().categories as Category[] }));
  registerHandler('GET', '/api/rules', () => ({ rules: getState().rules as Rule[] }));
  registerHandler('GET', '/api/transfer-rules', () => ({ transferRules: getState().transferRules as TransferRule[] }));
  registerHandler('GET', '/api/budgets', () => ({ budgets: getState().budgets as Budget[] }));
  registerHandler('GET', '/api/settings', () => ({ settings: getState().settings }));
}
