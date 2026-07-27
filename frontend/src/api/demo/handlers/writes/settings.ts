import { getState, setState, type DemoState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';

function handleSettingsPatch(req: DemoRequest) {
  const patch = (req.body ?? {}) as Record<string, unknown>;
  setState((s) => { s.settings = { ...s.settings, ...patch }; });
  return { settings: getState().settings };
}

// Full state envelope. In real mode the backend returns a versioned dump;
// in demo mode the seed IS the dump, so we return the store as JSON.
// BackupPanel always POSTs now (passphrases are mandatory); demo data is
// synthetic, so the "encrypted" export is just the seed state — the demo
// fetch patch (api/demo/index.ts) routes the raw fetch() here.
function handleBackupExport(): DemoState {
  return getState();
}

export function registerSettingsWriteHandlers(): void {
  registerHandler('PATCH', '/api/settings', handleSettingsPatch);
  registerHandler('POST', '/api/backup/export', handleBackupExport);
}
