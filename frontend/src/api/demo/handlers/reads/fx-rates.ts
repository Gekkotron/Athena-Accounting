// Mirrors backend/src/http/routes/fx-rates.ts's GET /api/fx-rates — same
// sort order: (from, to, effectiveFrom DESC).
import { getState, fxRateToWire } from '../../store';
import { registerHandler } from '../../index';

function handleList() {
  const rows = getState().fxRates ?? [];
  const sorted = [...rows].sort((a, b) =>
    a.fromCcy.localeCompare(b.fromCcy) ||
    a.toCcy.localeCompare(b.toCcy) ||
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  return { rates: sorted.map(fxRateToWire) };
}

export function registerFxRatesReadHandlers(): void {
  registerHandler('GET', '/api/fx-rates', handleList);
}
