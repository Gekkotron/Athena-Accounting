// Demo /api/loans*. Runs the REAL backend engine (pure module, bundled by
// Vite from outside frontend/src) so demo numbers match the server exactly.
import { buildSchedule, type LoanResult } from '../../../../../backend/src/domain/loans/engine/index';
import type { Loan, LoanInput, LoanTermsInput } from '../../../../../shared/api-contracts';
import { getState, setState } from '../store';
import { registerHandler, type DemoRequest } from '../index';
import { ApiError } from '../../apiError';
import { nextId } from './writes/lib';
import { todayLocalIso } from '../../../lib/dates';

const NAME_TAKEN = 'a loan with this name already exists';

// The seed's frozen "today" keeps the seeded progress stable.
function asOf(): string {
  const v = getState().settings.seedTodayForDemo;
  return typeof v === 'string' ? v : todayLocalIso();
}

function loansList(): Loan[] {
  return getState().loans ?? [];
}

function run(l: LoanTermsInput): LoanResult {
  return buildSchedule(
    {
      principal: l.principal,
      startDate: l.startDate,
      annualRate: l.annualRate,
      insuranceRate: l.insuranceRate,
      insuranceBasis: l.insuranceBasis,
      fees: l.fees,
      periods: l.periods,
      finalPeriod: l.finalPeriod,
      earlyRepayments: l.earlyRepayments,
    },
    asOf(),
  );
}

function notFound(): never {
  throw new ApiError('not found', 404, { error: 'not found' });
}

function loanOrThrow(id: number): Loan {
  return loansList().find((l) => l.id === id) ?? notFound();
}

function invalid(errors: unknown): never {
  throw new ApiError('invalid loan', 422, { error: 'invalid loan', errors });
}

function readInput(req: DemoRequest, selfId: number | null) {
  const b = (req.body ?? {}) as Partial<LoanInput>;
  if (typeof b.name !== 'string' || !b.name.trim() || !b.finalPeriod) {
    throw new ApiError('invalid input', 400, { error: 'invalid input' });
  }
  const input: LoanInput = {
    name: b.name.trim(),
    kind: b.kind ?? 'other',
    isSimulation: b.isSimulation ?? false,
    sourceLoanId: b.sourceLoanId ?? null,
    currency: b.currency ?? 'EUR',
    principal: b.principal ?? '',
    startDate: b.startDate ?? '',
    annualRate: b.annualRate ?? '',
    insuranceRate: b.insuranceRate ?? '0',
    insuranceBasis: b.insuranceBasis ?? 'initial',
    fees: b.fees ?? '0',
    periods: b.periods ?? [],
    finalPeriod: b.finalPeriod,
    earlyRepayments: b.earlyRepayments ?? [],
  };
  if (input.sourceLoanId !== null
    && (input.sourceLoanId === selfId || !loansList().some((l) => l.id === input.sourceLoanId))) {
    notFound();
  }
  if (loansList().some((l) => l.name === input.name && l.id !== selfId)) {
    throw new ApiError(NAME_TAKEN, 409, { error: NAME_TAKEN });
  }
  const res = run(input);
  if (!res.ok) invalid(res.errors);
  return { input, summary: res.summary };
}

function handleList() {
  return {
    loans: loansList().map((l) => {
      const res = run(l);
      return { ...l, summary: res.ok ? res.summary : null };
    }),
  };
}

function handleGet(req: DemoRequest) {
  const loan = loanOrThrow(Number(req.query.id));
  const res = run(loan);
  if (!res.ok) return { loan, schedule: [], summary: null, warnings: [], errors: res.errors };
  return { loan, schedule: res.schedule, summary: res.summary, warnings: res.warnings };
}

function handleCreate(req: DemoRequest) {
  const { input, summary } = readInput(req, null);
  const now = new Date().toISOString();
  let loan: Loan | null = null;
  setState((s) => {
    const list = (s.loans ??= []);
    loan = { ...input, id: nextId(list), createdAt: now, updatedAt: now };
    list.push(loan);
  });
  return { loan, summary };
}

function handleUpdate(req: DemoRequest) {
  const id = Number(req.query.id);
  const current = loanOrThrow(id);
  const { input, summary } = readInput(req, id);
  const loan: Loan = { ...input, id, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
  setState((s) => {
    s.loans = (s.loans ?? []).map((l) => (l.id === id ? loan : l));
  });
  return { loan, summary };
}

function handleDelete(req: DemoRequest) {
  const id = Number(req.query.id);
  loanOrThrow(id);
  setState((s) => {
    s.loans = (s.loans ?? [])
      .filter((l) => l.id !== id)
      .map((l) => (l.sourceLoanId === id ? { ...l, sourceLoanId: null } : l));
  });
  return { ok: true };
}

function handleConvert(req: DemoRequest) {
  const id = Number(req.query.id);
  const current = loanOrThrow(id);
  if (!current.isSimulation) {
    throw new ApiError('loan is not a simulation', 400, { error: 'loan is not a simulation' });
  }
  const loan: Loan = { ...current, isSimulation: false, sourceLoanId: null, updatedAt: new Date().toISOString() };
  setState((s) => {
    s.loans = (s.loans ?? []).map((l) => (l.id === id ? loan : l));
  });
  const res = run(loan);
  if (!res.ok) invalid(res.errors);
  return { loan, summary: res.summary };
}

function handleSimulate(req: DemoRequest) {
  const b = (req.body ?? {}) as Partial<LoanTermsInput>;
  if (!b.finalPeriod || typeof b.principal !== 'string') {
    throw new ApiError('invalid input', 400, { error: 'invalid input' });
  }
  const res = run({
    principal: b.principal,
    startDate: b.startDate ?? '',
    annualRate: b.annualRate ?? '',
    insuranceRate: b.insuranceRate ?? '0',
    insuranceBasis: b.insuranceBasis ?? 'initial',
    fees: b.fees ?? '0',
    periods: b.periods ?? [],
    finalPeriod: b.finalPeriod,
    earlyRepayments: b.earlyRepayments ?? [],
  });
  if (!res.ok) invalid(res.errors);
  return { schedule: res.schedule, summary: res.summary, warnings: res.warnings };
}

export function registerLoansHandlers(): void {
  registerHandler('GET', '/api/loans', handleList);
  registerHandler('POST', '/api/loans/simulate', handleSimulate);
  registerHandler('POST', '/api/loans', handleCreate);
  registerHandler('GET', '/api/loans/:id', handleGet);
  registerHandler('PUT', '/api/loans/:id', handleUpdate);
  registerHandler('DELETE', '/api/loans/:id', handleDelete);
  registerHandler('POST', '/api/loans/:id/convert', handleConvert);
}
