// Mirrors backend/src/http/routes/fx-rates.ts's POST/PATCH/DELETE handlers.
// Validation rules match the backend's Zod schemas (3-letter uppercase
// codes, from !== to, ISO date, numeric rate string > 0); the duplicate
// check is a simple (from,to,effectiveFrom) map-key equality instead of the
// backend's DB unique constraint — same observable 409, simpler mechanism
// (the demo has no DB to violate a constraint against).
import { getState, setState, fxRateToWire, type DemoFxRate } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { ApiError } from '../../../apiError';
import { nextId } from './lib';

const CCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RATE_RE = /^\d+(\.\d{1,10})?$/;

function isValidRate(rate: string): boolean {
  return RATE_RE.test(rate) && Number(rate) > 0;
}

interface CreateBody {
  from?: string;
  to?: string;
  effectiveFrom?: string;
  rate?: string;
}

function validateCreate(body: CreateBody): asserts body is Required<CreateBody> {
  if (typeof body.from !== 'string' || !CCY_RE.test(body.from)) {
    throw new ApiError('invalid input', 400, { error: 'invalid input' });
  }
  if (typeof body.to !== 'string' || !CCY_RE.test(body.to)) {
    throw new ApiError('invalid input', 400, { error: 'invalid input' });
  }
  if (body.from === body.to) {
    throw new ApiError('invalid input', 400, { error: 'invalid input' });
  }
  if (typeof body.effectiveFrom !== 'string' || !DATE_RE.test(body.effectiveFrom)) {
    throw new ApiError('invalid input', 400, { error: 'invalid input' });
  }
  if (typeof body.rate !== 'string' || !isValidRate(body.rate)) {
    throw new ApiError('invalid input', 400, { error: 'invalid input' });
  }
}

function isDuplicate(rows: DemoFxRate[], from: string, to: string, effectiveFrom: string, excludeId?: number): boolean {
  return rows.some((r) =>
    r.id !== excludeId && r.fromCcy === from && r.toCcy === to && r.effectiveFrom === effectiveFrom,
  );
}

function conflictError(): ApiError {
  return new ApiError('conflict', 409, { error: 'conflict', code: 'DUPLICATE_RATE' });
}

function handleCreate(req: DemoRequest) {
  const body = (req.body ?? {}) as CreateBody;
  validateCreate(body);
  const { from, to, effectiveFrom, rate } = body;
  const rows = getState().fxRates ?? [];
  if (isDuplicate(rows, from, to, effectiveFrom)) throw conflictError();
  const created: DemoFxRate = { id: nextId(rows), fromCcy: from, toCcy: to, effectiveFrom, rate };
  setState((s) => { (s.fxRates ??= []).push(created); });
  return { rate: fxRateToWire(created) };
}

interface PatchBody {
  rate?: string;
  effectiveFrom?: string;
}

function validatePatch(body: PatchBody): void {
  if (body.rate === undefined && body.effectiveFrom === undefined) {
    throw new ApiError('invalid input', 400, { error: 'invalid input' });
  }
  if (body.rate !== undefined && !isValidRate(body.rate)) {
    throw new ApiError('invalid input', 400, { error: 'invalid input' });
  }
  if (body.effectiveFrom !== undefined && !DATE_RE.test(body.effectiveFrom)) {
    throw new ApiError('invalid input', 400, { error: 'invalid input' });
  }
}

function handlePatch(req: DemoRequest) {
  const id = Number(req.query.id);
  const patch = (req.body ?? {}) as PatchBody;
  validatePatch(patch);
  let updated: DemoFxRate | null = null;
  let conflict = false;
  setState((s) => {
    const rows = (s.fxRates ??= []);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const current = rows[idx]!;
    const next: DemoFxRate = {
      ...current,
      ...(patch.rate !== undefined ? { rate: patch.rate } : {}),
      ...(patch.effectiveFrom !== undefined ? { effectiveFrom: patch.effectiveFrom } : {}),
    };
    if (isDuplicate(rows, next.fromCcy, next.toCcy, next.effectiveFrom, id)) {
      conflict = true;
      return;
    }
    rows[idx] = next;
    updated = next;
  });
  if (conflict) throw conflictError();
  if (!updated) throw new ApiError('not_found', 404, { error: 'not_found' });
  return { rate: fxRateToWire(updated) };
}

function handleDelete(req: DemoRequest) {
  const id = Number(req.query.id);
  setState((s) => { s.fxRates = (s.fxRates ?? []).filter((r) => r.id !== id); });
  return null;
}

export function registerFxRatesWriteHandlers(): void {
  registerHandler('POST', '/api/fx-rates', handleCreate);
  registerHandler('PATCH', '/api/fx-rates/:id', handlePatch);
  registerHandler('DELETE', '/api/fx-rates/:id', handleDelete);
}
