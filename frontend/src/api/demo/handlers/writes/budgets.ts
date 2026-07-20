import type { Budget } from '../../../types';
import { getState, setState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { nextId } from './lib';

function handleBudgetCreate(req: DemoRequest) {
  const body = (req.body ?? {}) as Partial<Budget>;
  const b: Budget = {
    id: nextId(getState().budgets),
    categoryId: body.categoryId ?? getState().categories[0].id,
    monthlyLimit: body.monthlyLimit ?? '0.00',
    currency: body.currency ?? 'EUR',
    period: body.period ?? 'monthly',
    accountId: body.accountId ?? null,
  };
  setState((s) => { s.budgets.push(b); });
  return { budget: b };
}

function handleBudgetUpdate(req: DemoRequest) {
  const id = Number(req.query.id);
  const patch = (req.body ?? {}) as Partial<Budget>;
  let updated: Budget | null = null;
  setState((s) => {
    const idx = s.budgets.findIndex((b) => b.id === id);
    if (idx < 0) return;
    s.budgets[idx] = { ...s.budgets[idx], ...patch };
    updated = s.budgets[idx];
  });
  return { budget: updated };
}

function handleBudgetDelete(req: DemoRequest) {
  const id = Number(req.query.id);
  setState((s) => { s.budgets = s.budgets.filter((b) => b.id !== id); });
  return null;
}

export function registerBudgetsWriteHandlers(): void {
  registerHandler('POST', '/api/budgets', handleBudgetCreate);
  registerHandler('PUT', '/api/budgets/:id', handleBudgetUpdate);
  registerHandler('PATCH', '/api/budgets/:id', handleBudgetUpdate);
  registerHandler('DELETE', '/api/budgets/:id', handleBudgetDelete);
}
