import type { RecurringEssentialness, RecurringSeries, RecurringStatus } from '../../../types';
import { getState, setState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';

interface RecurringPatchBody {
  status?: RecurringStatus;
  essentialness?: RecurringEssentialness | null;
}

function handleRecurringUpdate(req: DemoRequest) {
  const id = Number(req.query.id);
  const patch = (req.body ?? {}) as RecurringPatchBody;
  let updated: RecurringSeries | null = null;
  setState((s) => {
    const list = s.recurring ?? [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const before = list[idx]!;
    const next: RecurringSeries = {
      ...before,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.essentialness !== undefined ? { essentialness: patch.essentialness } : {}),
      updatedAt: new Date().toISOString(),
    };
    list[idx] = next;
    s.recurring = list;
    updated = next;
  });
  if (!updated) return { error: 'not found' };
  return { recurring: updated };
}

// Demo has no real detector — regenerate is a no-op that reports the
// current count. Keeping the endpoint live means the "Régénérer" button
// works without triggering the demoMissingHandler modal.
function handleRecurringRegenerate() {
  const rows = getState().recurring ?? [];
  const detected = rows.filter((r) => r.status === 'detected').length;
  const refreshed = rows.filter((r) => r.status !== 'detected').length;
  return { ok: true, detected, refreshed };
}

export function registerRecurringWriteHandlers(): void {
  registerHandler('PUT', '/api/recurring/:id', handleRecurringUpdate);
  registerHandler('POST', '/api/recurring/regenerate', handleRecurringRegenerate);
}
