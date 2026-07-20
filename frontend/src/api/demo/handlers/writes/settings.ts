import { getState, setState, type DemoState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';

function handleSettingsPatch(req: DemoRequest) {
  const patch = (req.body ?? {}) as Record<string, unknown>;
  setState((s) => { s.settings = { ...s.settings, ...patch }; });
  return { settings: getState().settings };
}

// Full state envelope. In real mode the backend returns a versioned dump;
// in demo mode the seed IS the dump, so we return the store as JSON.
// BackupPanel today uses raw fetch() so this handler is unused until the
// backup export gets rewired through api().
function handleBackupExport(): DemoState {
  return getState();
}

export function registerSettingsWriteHandlers(): void {
  registerHandler('PATCH', '/api/settings', handleSettingsPatch);
  registerHandler('GET', '/api/backup/export', handleBackupExport);
}
