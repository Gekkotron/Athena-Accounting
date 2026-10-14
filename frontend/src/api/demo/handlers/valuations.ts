import type { DemoAccountValuation } from '../store';
import { getState, setState } from '../store';
import { registerHandler, type DemoRequest } from '../index';
import { ApiError } from '../../apiError';
import { todayIso } from './reads/lib';
import { nextId } from './writes/lib';

type Wire = { id: number; date: string; value: string; source: string };
const toWire = (v: DemoAccountValuation): Wire => ({ id: v.id, date: v.date, value: v.value, source: v.source });

function findAccount(raw: string) {
  const acc = getState().accounts.find((a) => a.id === Number(raw));
  if (!acc) throw new ApiError('not found', 404, { error: 'not found' });
  return acc;
}

function handleList(req: DemoRequest) {
  const acc = findAccount(req.query.id ?? '');
  return (getState().accountValuations ?? [])
    .filter((v) => v.accountId === acc.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(toWire);
}

function handlePut(req: DemoRequest) {
  const acc = findAccount(req.query.id ?? '');
  const body = (req.body ?? {}) as { date?: string; value?: string };
  if (acc.type !== 'investment') throw new ApiError('not an investment account', 400, { error: 'not an investment account' });
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || body.date > todayIso()) {
    throw new ApiError('invalid date', 400, { error: 'invalid date' });
  }
  if (!body.value || !/^-?\d+(\.\d{1,2})?$/.test(body.value)) {
    throw new ApiError('invalid value', 400, { error: 'invalid value' });
  }
  let row!: DemoAccountValuation;
  setState((s) => {
    const list = (s.accountValuations ??= []);
    const existing = list.find((v) => v.accountId === acc.id && v.date === body.date);
    if (existing) {
      existing.value = Number(body.value).toFixed(2);
      row = existing;
    } else {
      row = { id: nextId(list), accountId: acc.id, date: body.date!, value: Number(body.value).toFixed(2), source: 'manual' };
      list.push(row);
    }
  });
  return toWire(row);
}

function handleDelete(req: DemoRequest) {
  const acc = findAccount(req.query.id ?? '');
  const vid = Number(req.query.valuationId);
  setState((s) => {
    s.accountValuations = (s.accountValuations ?? []).filter((v) => !(v.accountId === acc.id && v.id === vid));
  });
  return null;
}

export function registerValuationHandlers(): void {
  registerHandler('GET', '/api/accounts/:id/valuations', handleList);
  registerHandler('PUT', '/api/accounts/:id/valuations', handlePut);
  registerHandler('DELETE', '/api/accounts/:id/valuations/:valuationId', handleDelete);
}
