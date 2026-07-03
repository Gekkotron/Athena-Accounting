import { api } from './client';
import type { Settings } from '../lib/settings';

export function getSettings() {
  return api<{ settings: Settings }>('/api/settings');
}

export function patchSettings(patch: Partial<Settings>) {
  return api<{ settings: Settings }>('/api/settings', {
    method: 'PATCH',
    json: patch,
  });
}
