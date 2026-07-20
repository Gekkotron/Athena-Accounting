import type { Category, Transaction } from '../../../types';
import { getState, setState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { nextId } from './lib';

function handleCategoryCreate(req: DemoRequest) {
  const body = (req.body ?? {}) as Partial<Category>;
  const cat: Category = {
    id: nextId(getState().categories),
    name: body.name ?? 'Sans nom',
    kind: body.kind ?? 'expense',
    color: body.color ?? null,
    parentId: body.parentId ?? null,
    isDefault: false,
    isInternalTransfer: body.isInternalTransfer ?? false,
  };
  setState((s) => { s.categories.push(cat); });
  return { category: cat };
}

function handleCategoryUpdate(req: DemoRequest) {
  const id = Number(req.query.id);
  const patch = (req.body ?? {}) as Partial<Category>;
  let updated: Category | null = null;
  setState((s) => {
    const idx = s.categories.findIndex((c) => c.id === id);
    if (idx < 0) return;
    s.categories[idx] = { ...s.categories[idx], ...patch };
    updated = s.categories[idx];
  });
  return { category: updated };
}

function handleCategoryDelete(req: DemoRequest) {
  const id = Number(req.query.id);
  setState((s) => {
    s.categories = s.categories.filter((c) => c.id !== id);
    for (const t of s.transactions as Transaction[]) {
      if (t.categoryId === id) t.categoryId = null;
    }
  });
  return { ok: true };
}

export function registerCategoriesWriteHandlers(): void {
  registerHandler('POST', '/api/categories', handleCategoryCreate);
  registerHandler('PUT', '/api/categories/:id', handleCategoryUpdate);
  registerHandler('PATCH', '/api/categories/:id', handleCategoryUpdate);
  registerHandler('DELETE', '/api/categories/:id', handleCategoryDelete);
}
