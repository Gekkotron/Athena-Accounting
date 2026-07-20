import type { Account, Transaction } from '../../../types';
import { getState, setState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { nextId } from './lib';

interface AccountCreateBody {
  name: string;
  type?: string;
  currency?: string;
  openingBalance?: string;
  openingDate?: string;
  displayOrder?: number;
  lockYears?: number | null;
}

function handleAccountCreate(req: DemoRequest) {
  const body = (req.body ?? {}) as AccountCreateBody;
  const acc: Account = {
    id: nextId(getState().accounts),
    name: body.name ?? 'Nouveau compte',
    type: body.type ?? 'checking',
    currency: body.currency ?? 'EUR',
    openingBalance: body.openingBalance ?? '0.00',
    openingDate: body.openingDate ?? new Date().toISOString().slice(0, 10),
    displayOrder: body.displayOrder ?? getState().accounts.length,
    lockYears: body.lockYears ?? null,
    createdAt: new Date().toISOString(),
  };
  setState((s) => { s.accounts.push(acc); });
  return { account: acc };
}

function handleAccountUpdate(req: DemoRequest) {
  const id = Number(req.query.id);
  const patch = (req.body ?? {}) as Partial<Account>;
  let updated: Account | null = null;
  setState((s) => {
    const idx = s.accounts.findIndex((a) => a.id === id);
    if (idx < 0) return;
    s.accounts[idx] = { ...s.accounts[idx], ...patch };
    updated = s.accounts[idx];
  });
  return { account: updated };
}

function handleAccountDelete(req: DemoRequest) {
  const id = Number(req.query.id);
  setState((s) => {
    s.accounts = s.accounts.filter((a) => a.id !== id);
    s.transactions = (s.transactions as Transaction[]).filter((t) => t.accountId !== id);
  });
  return { ok: true };
}

export function registerAccountsWriteHandlers(): void {
  registerHandler('POST', '/api/accounts', handleAccountCreate);
  registerHandler('PUT', '/api/accounts/:id', handleAccountUpdate);
  registerHandler('PATCH', '/api/accounts/:id', handleAccountUpdate);
  registerHandler('DELETE', '/api/accounts/:id', handleAccountDelete);
}
