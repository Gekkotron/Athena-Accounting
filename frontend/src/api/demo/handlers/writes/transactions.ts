import type { Transaction } from '../../../types';
import { getState, setState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { nextId } from './lib';

interface TxPatchBody {
  categoryId?: number | null;
  notes?: string | null;
  memo?: string | null;
  lockYears?: number | null;
}

function handleTxPatch(req: DemoRequest) {
  const id = Number(req.query.id);
  const body = (req.body ?? {}) as TxPatchBody;
  let updated: Transaction | null = null;
  setState((s) => {
    const list = s.transactions as Transaction[];
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const before = list[idx];
    const next: Transaction = {
      ...before,
      ...(body.categoryId !== undefined
        ? { categoryId: body.categoryId, categorySource: 'manual' }
        : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.memo !== undefined ? { memo: body.memo } : {}),
      ...(body.lockYears !== undefined ? { lockYears: body.lockYears } : {}),
    };
    list[idx] = next;
    updated = next;
  });
  return { transaction: updated };
}

function handleTxDelete(req: DemoRequest) {
  const id = Number(req.query.id);
  setState((s) => {
    s.transactions = (s.transactions as Transaction[]).filter((t) => t.id !== id);
  });
  return { ok: true };
}

function handleTxCreate(req: DemoRequest) {
  const body = (req.body ?? {}) as Partial<Transaction>;
  const now = new Date().toISOString();
  const tx: Transaction = {
    id: nextId(getState().transactions as Transaction[]),
    accountId: body.accountId ?? getState().accounts[0]?.id ?? 1,
    date: body.date ?? now.slice(0, 10),
    amount: body.amount ?? '0.00',
    rawLabel: body.rawLabel ?? 'Nouvelle transaction',
    normalizedLabel: (body.rawLabel ?? '').toLowerCase(),
    memo: body.memo ?? null,
    notes: body.notes ?? null,
    fitid: null,
    dedupKey: `manual_${Date.now()}`,
    categoryId: body.categoryId ?? null,
    categorySource: 'manual',
    transferGroupId: null,
    sourceFileId: null,
    importedAt: now,
    lockYears: body.lockYears ?? null,
    splits: [],
  };
  setState((s) => { (s.transactions as Transaction[]).push(tx); });
  return { transaction: tx };
}

export function registerTransactionsWriteHandlers(): void {
  registerHandler('POST', '/api/transactions', handleTxCreate);
  registerHandler('PATCH', '/api/transactions/:id', handleTxPatch);
  registerHandler('DELETE', '/api/transactions/:id', handleTxDelete);
}
