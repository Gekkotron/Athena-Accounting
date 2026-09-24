import { describe, it, expect, beforeEach } from 'vitest';
import { api, registerSeedProvider, getState } from '../index';
import { __resetForTest } from '../store';
import { buildSeedState } from '../seed';
import { DEFAULTS } from '../../../lib/settings';

beforeEach(() => {
  __resetForTest();
  registerSeedProvider(buildSeedState);
});

describe('PATCH /api/settings — demo write handler', () => {
  it('merges patch into settings and returns full DEFAULTS-merged shape', async () => {
    const r = await api<{ settings: typeof DEFAULTS }>('/api/settings', {
      method: 'PATCH',
      json: { backupHour: 7 },
    });
    expect(r.settings.backupHour).toBe(7);
    // Untouched defaults still present.
    expect(r.settings.bankSyncHour).toBe(DEFAULTS.bankSyncHour);
    expect(r.settings.notifications).toEqual(DEFAULTS.notifications);
  });

  it('a follow-up patch does not clobber the earlier one', async () => {
    await api('/api/settings', { method: 'PATCH', json: { backupHour: 11 } });
    const r = await api<{ settings: typeof DEFAULTS }>('/api/settings', {
      method: 'PATCH',
      json: { bankSyncHour: 5 },
    });
    expect(r.settings.backupHour).toBe(11);
    expect(r.settings.bankSyncHour).toBe(5);
  });
});

describe('POST /api/backup/export — demo backup handler', () => {
  it('returns the current demo state envelope', async () => {
    const before = getState();
    const r = await api<typeof before>('/api/backup/export', { method: 'POST' });
    expect(r.v).toBe(before.v);
    expect(r.accounts).toEqual(before.accounts);
    expect(r.transactions.length).toBe(before.transactions.length);
  });
});

describe('backup destination — PUT / DELETE / run-now', () => {
  it('PUT stores non-secret config and hides passphrase/password', async () => {
    const r = await api<{
      configured: boolean; kind: string;
      config: Record<string, unknown>; enabled: boolean;
      auto: { enabled: boolean; hour: number };
    }>('/api/backup/destination', {
      method: 'PUT',
      json: {
        kind: 'webdav',
        url: 'https://drive.example/dav',
        username: 'user',
        passphrase: 'shh',
        password: 'also-shh',
        enabled: true,
      },
    });
    expect(r.configured).toBe(true);
    expect(r.kind).toBe('webdav');
    expect(r.enabled).toBe(true);
    expect(r.config.url).toBe('https://drive.example/dav');
    expect(r.config.username).toBe('user');
    expect(r.config).not.toHaveProperty('passphrase');
    expect(r.config).not.toHaveProperty('password');
    expect(r.auto).toEqual({ enabled: true, hour: 3, nextAt: null });
    // Stored on state so DELETE + subsequent reads have it.
    expect(getState().backupDestination?.kind).toBe('webdav');
  });

  it('PUT enabled=false → destination stored with enabled=false', async () => {
    const r = await api<{ enabled: boolean }>('/api/backup/destination', {
      method: 'PUT',
      json: { kind: 'folder', path: '/backups', enabled: false },
    });
    expect(r.enabled).toBe(false);
  });

  it('DELETE clears the stored destination and returns configured=false', async () => {
    await api('/api/backup/destination', {
      method: 'PUT',
      json: { kind: 'folder', path: '/x' },
    });
    expect(getState().backupDestination).toBeDefined();
    const r = await api<{ configured: boolean }>('/api/backup/destination', {
      method: 'DELETE',
    });
    expect(r.configured).toBe(false);
    expect(getState().backupDestination).toBeUndefined();
  });

  it('run-now returns a timestamped filename and stamps lastRunAt on the destination', async () => {
    await api('/api/backup/destination', {
      method: 'PUT',
      json: { kind: 'folder', path: '/x' },
    });
    const r = await api<{ filename: string }>('/api/backup/destination/run-now', {
      method: 'POST',
    });
    // athena-backup-YYYY-MM-DD-HHMMSS.enc.json
    expect(r.filename).toMatch(/^athena-backup-\d{4}-\d{2}-\d{2}-\d{6}\.enc\.json$/);
    expect(getState().backupDestination?.lastRunAt).not.toBeNull();
  });

  it('run-now with no destination stored → filename returned, state.backupDestination stays undefined', async () => {
    const r = await api<{ filename: string }>('/api/backup/destination/run-now', {
      method: 'POST',
    });
    expect(r.filename).toMatch(/^athena-backup-/);
    expect(getState().backupDestination).toBeUndefined();
  });
});
