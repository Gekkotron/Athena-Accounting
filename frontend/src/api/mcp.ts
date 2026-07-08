import { api } from './client';

export function getMcpSettings() {
  return api<{ enabled: boolean; hasToken: boolean }>('/api/settings/mcp');
}
export function setMcpEnabled(enabled: boolean) {
  return api<{ enabled: boolean; hasToken: boolean }>('/api/settings/mcp', { method: 'PUT', json: { enabled } });
}
export function generateMcpToken() {
  return api<{ token: string }>('/api/settings/mcp/token', { method: 'POST' });
}
export function revokeMcpToken() {
  return api<{ ok: boolean }>('/api/settings/mcp/token', { method: 'DELETE' });
}
