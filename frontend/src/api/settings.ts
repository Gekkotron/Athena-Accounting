import { api } from './client';
import type { Settings, SettingsPatch } from '../lib/settings';

export function getSettings() {
  return api<{ settings: Settings }>('/api/settings');
}

export function patchSettings(patch: SettingsPatch) {
  return api<{ settings: Settings }>('/api/settings', {
    method: 'PATCH',
    json: patch,
  });
}
