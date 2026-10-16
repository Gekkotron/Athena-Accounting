// Public entry of the loan engine. Pure: no DB, no Node APIs, no deps —
// imported by the backend routes AND by the frontend demo handler.
import { buildRows } from './schedule.js';
import { summarize } from './summary.js';
import type { LoanResult, LoanTerms } from './types.js';
import { validateTerms } from './validate.js';

export * from './types.js';

export function buildSchedule(terms: LoanTerms, asOf: string): LoanResult {
  const errors = validateTerms(terms);
  if (errors.length > 0) return { ok: false, errors };
  const res = buildRows(terms);
  if ('errors' in res) return { ok: false, errors: res.errors };
  return {
    ok: true,
    schedule: res.rows,
    summary: summarize(terms, res.rows, res.penalties, res.solvedPayment, asOf),
    warnings: res.warnings,
  };
}
