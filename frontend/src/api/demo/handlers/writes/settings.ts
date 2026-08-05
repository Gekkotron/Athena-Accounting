import { DEFAULTS } from '../../../../lib/settings';
import { getState, setState, type DemoState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';

function handleSettingsPatch(req: DemoRequest) {
  const patch = (req.body ?? {}) as Record<string, unknown>;
  setState((s) => { s.settings = { ...s.settings, ...patch }; });
  // Same defaults merge as the GET handler — the response shape must stay
  // full so optimistic cache updates don't reintroduce undefined keys.
  return { settings: { ...DEFAULTS, ...getState().settings } };
}

// Full state envelope. In real mode the backend returns a versioned dump;
// in demo mode the seed IS the dump, so we return the store as JSON.
// BackupPanel always POSTs now (passphrases are mandatory); demo data is
// synthetic, so the "encrypted" export is just the seed state — the demo
// fetch patch (api/demo/index.ts) routes the raw fetch() here.
function handleBackupExport(): DemoState {
  return getState();
}

// Sauvegarde distante: stores only the non-secret config so the card
// round-trips, and fakes a successful run. No real writes anywhere.
function handleDestinationPut(req: DemoRequest) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { kind, passphrase: _passphrase, password: _password, enabled, ...config } = body;
  const dest = {
    kind: kind as 'webdav' | 'folder',
    config,
    enabled: enabled !== false,
    lastRunAt: null,
    lastError: null,
  };
  setState((s) => {
    s.backupDestination = dest;
  });
  return { configured: true, ...dest, auto: { enabled: true, hour: 3, nextAt: null } };
}

function handleDestinationRunNow() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  setState((s) => {
    if (s.backupDestination) {
      s.backupDestination = { ...s.backupDestination, lastRunAt: now.toISOString() };
    }
  });
  return { filename: `athena-backup-${stamp}.enc.json` };
}

export function registerSettingsWriteHandlers(): void {
  registerHandler('PATCH', '/api/settings', handleSettingsPatch);
  registerHandler('POST', '/api/backup/export', handleBackupExport);
  registerHandler('PUT', '/api/backup/destination', handleDestinationPut);
  registerHandler('DELETE', '/api/backup/destination', () => {
    setState((s) => {
      delete s.backupDestination;
    });
    return { configured: false };
  });
  registerHandler('POST', '/api/backup/destination/run-now', handleDestinationRunNow);
}
