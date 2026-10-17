import { api } from './client';
import { ApiError } from './apiError';
import type {
  Loan,
  LoanDetail,
  LoanInput,
  LoanIssue,
  LoanListItem,
  LoanSimulation,
  LoanSummary,
  LoanTermsInput,
} from '../../../shared/api-contracts';

export type {
  Loan,
  LoanDetail,
  LoanEarlyRepayment,
  LoanFinalPeriod,
  LoanFixedPeriod,
  LoanFixedPeriodKind,
  LoanInput,
  LoanInsuranceBasis,
  LoanIssue,
  LoanKind,
  LoanListItem,
  LoanRepaymentEffect,
  LoanScheduleRow,
  LoanSimulation,
  LoanSummary,
  LoanTermsInput,
} from '../../../shared/api-contracts';

export function listLoans() {
  return api<{ loans: LoanListItem[] }>('/api/loans');
}

export function getLoan(id: number) {
  return api<LoanDetail>(`/api/loans/${id}`);
}

export function createLoan(body: LoanInput) {
  return api<{ loan: Loan; summary: LoanSummary }>('/api/loans', { method: 'POST', json: body });
}

export function updateLoan(id: number, body: LoanInput) {
  return api<{ loan: Loan; summary: LoanSummary }>(`/api/loans/${id}`, { method: 'PUT', json: body });
}

export function deleteLoan(id: number) {
  return api<{ ok: true }>(`/api/loans/${id}`, { method: 'DELETE' });
}

export function convertSimulation(id: number) {
  return api<{ loan: Loan; summary: LoanSummary }>(`/api/loans/${id}/convert`, { method: 'POST' });
}

export function simulateLoan(terms: LoanTermsInput) {
  return api<LoanSimulation>('/api/loans/simulate', { method: 'POST', json: terms });
}

// The engine's issues carried by a 422; null for every other failure.
export function loanIssues(err: unknown): LoanIssue[] | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  const data = err.data as { errors?: LoanIssue[] } | null;
  return data?.errors ?? [];
}

// Engine inputs of a loan — drops identity and metadata fields.
export function termsOf(l: LoanTermsInput): LoanTermsInput {
  return {
    principal: l.principal,
    startDate: l.startDate,
    annualRate: l.annualRate,
    insuranceRate: l.insuranceRate,
    insuranceBasis: l.insuranceBasis,
    insuranceAmount: l.insuranceAmount,
    fees: l.fees,
    periods: l.periods,
    finalPeriod: l.finalPeriod,
    earlyRepayments: l.earlyRepayments,
  };
}
