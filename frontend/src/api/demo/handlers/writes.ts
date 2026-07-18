// Write-side handlers for the browser-only demo. Every mutation goes
// through store.setState() so the change persists to localStorage and
// notifies subscribers (Task 6 wires TanStack Query invalidation to
// the subscription so the UI re-renders after a reset).

import type {
  Account,
  Budget,
  Category,
  Rule,
  Transaction,
  TransferRule,
} from '../../types';
import { getState, setState, type DemoState } from '../store';
import { registerHandler, type DemoRequest } from '../index';

function nextId<T extends { id: number }>(rows: T[]): number {
  return rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Transactions — PATCH (inline edit) + DELETE + POST (create)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Categories / rules / budgets / transfer-rules — thin CRUD
// ---------------------------------------------------------------------------

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

function handleRuleCreate(req: DemoRequest) {
  const body = (req.body ?? {}) as Partial<Rule>;
  const rule: Rule = {
    id: nextId(getState().rules),
    categoryId: body.categoryId ?? getState().categories[0].id,
    keyword: body.keyword ?? '',
    signConstraint: body.signConstraint ?? 'any',
    matchMode: body.matchMode ?? 'substring',
    priority: body.priority ?? 100,
    enabled: body.enabled ?? true,
    createdAt: new Date().toISOString(),
  };
  setState((s) => { s.rules.push(rule); });
  return { rule };
}

function handleRuleUpdate(req: DemoRequest) {
  const id = Number(req.query.id);
  const patch = (req.body ?? {}) as Partial<Rule>;
  let updated: Rule | null = null;
  setState((s) => {
    const idx = s.rules.findIndex((r) => r.id === id);
    if (idx < 0) return;
    s.rules[idx] = { ...s.rules[idx], ...patch };
    updated = s.rules[idx];
  });
  return { rule: updated };
}

function handleRuleDelete(req: DemoRequest) {
  const id = Number(req.query.id);
  setState((s) => { s.rules = s.rules.filter((r) => r.id !== id); });
  return { ok: true };
}

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

function handleTransferRuleCreate(req: DemoRequest) {
  const body = (req.body ?? {}) as Partial<TransferRule>;
  const tr: TransferRule = {
    id: nextId(getState().transferRules),
    keyword: body.keyword ?? '',
    direction: body.direction ?? 'outgoing',
    counterpartAccountId: body.counterpartAccountId ?? null,
    enabled: body.enabled ?? true,
  };
  setState((s) => { s.transferRules.push(tr); });
  return { transferRule: tr };
}

function handleTransferRuleUpdate(req: DemoRequest) {
  const id = Number(req.query.id);
  const patch = (req.body ?? {}) as Partial<TransferRule>;
  let updated: TransferRule | null = null;
  setState((s) => {
    const idx = s.transferRules.findIndex((r) => r.id === id);
    if (idx < 0) return;
    s.transferRules[idx] = { ...s.transferRules[idx], ...patch };
    updated = s.transferRules[idx];
  });
  return { transferRule: updated };
}

function handleTransferRuleDelete(req: DemoRequest) {
  const id = Number(req.query.id);
  setState((s) => { s.transferRules = s.transferRules.filter((r) => r.id !== id); });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tri assign + Recategorize
// ---------------------------------------------------------------------------

interface TriAssignBody {
  normalizedLabels: string[];
  categoryId: number | null;
  createRule?: boolean;
}

function handleTriAssign(req: DemoRequest) {
  const body = (req.body ?? {}) as TriAssignBody;
  let updated = 0;
  setState((s) => {
    for (const t of s.transactions as Transaction[]) {
      if (body.normalizedLabels.includes(t.normalizedLabel)) {
        t.categoryId = body.categoryId;
        t.categorySource = 'manual';
        updated += 1;
      }
    }
    if (body.createRule && body.categoryId != null) {
      for (const label of body.normalizedLabels) {
        s.rules.push({
          id: nextId(s.rules),
          categoryId: body.categoryId,
          keyword: label,
          signConstraint: 'any',
          matchMode: 'substring',
          priority: 100,
          enabled: true,
          createdAt: new Date().toISOString(),
        });
      }
    }
  });
  return { updated };
}

function matchesRule(t: Transaction, r: Rule): boolean {
  if (!r.enabled) return false;
  if (r.signConstraint === 'negative' && Number(t.amount) >= 0) return false;
  if (r.signConstraint === 'positive' && Number(t.amount) <= 0) return false;
  if (r.matchMode === 'regex') {
    try { return new RegExp(r.keyword, 'i').test(t.rawLabel); } catch { return false; }
  }
  return t.normalizedLabel.includes(r.keyword.toLowerCase());
}

function handleRecategorize() {
  let updated = 0;
  setState((s) => {
    const sorted = [...s.rules].sort((a, b) => b.priority - a.priority);
    for (const t of s.transactions as Transaction[]) {
      if (t.categorySource === 'manual') continue;
      for (const r of sorted) {
        if (matchesRule(t, r)) {
          if (t.categoryId !== r.categoryId) {
            t.categoryId = r.categoryId;
            t.categorySource = 'auto';
            updated += 1;
          }
          break;
        }
      }
    }
  });
  return { updated };
}

// ---------------------------------------------------------------------------
// Settings + backup export
// ---------------------------------------------------------------------------

function handleSettingsPatch(req: DemoRequest) {
  const patch = (req.body ?? {}) as Record<string, unknown>;
  setState((s) => { s.settings = { ...s.settings, ...patch }; });
  return { settings: getState().settings };
}

function handleBackupExport(): DemoState {
  // Full state envelope. In real mode the backend returns a versioned
  // dump; in demo mode the seed IS the dump, so we return the store as
  // JSON. BackupPanel today uses raw fetch() so this handler is unused
  // until Task 5 rewires the export button through api().
  return getState();
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function registerWriteHandlers(): void {
  registerHandler('POST',   '/api/accounts', handleAccountCreate);
  registerHandler('PUT',    '/api/accounts/:id', handleAccountUpdate);
  registerHandler('PATCH',  '/api/accounts/:id', handleAccountUpdate);
  registerHandler('DELETE', '/api/accounts/:id', handleAccountDelete);

  registerHandler('POST',   '/api/transactions', handleTxCreate);
  registerHandler('PATCH',  '/api/transactions/:id', handleTxPatch);
  registerHandler('DELETE', '/api/transactions/:id', handleTxDelete);

  registerHandler('POST',   '/api/categories', handleCategoryCreate);
  registerHandler('PUT',    '/api/categories/:id', handleCategoryUpdate);
  registerHandler('PATCH',  '/api/categories/:id', handleCategoryUpdate);
  registerHandler('DELETE', '/api/categories/:id', handleCategoryDelete);

  registerHandler('POST',   '/api/rules', handleRuleCreate);
  registerHandler('PUT',    '/api/rules/:id', handleRuleUpdate);
  registerHandler('PATCH',  '/api/rules/:id', handleRuleUpdate);
  registerHandler('DELETE', '/api/rules/:id', handleRuleDelete);

  registerHandler('POST',   '/api/budgets', handleBudgetCreate);
  registerHandler('PUT',    '/api/budgets/:id', handleBudgetUpdate);
  registerHandler('PATCH',  '/api/budgets/:id', handleBudgetUpdate);
  registerHandler('DELETE', '/api/budgets/:id', handleBudgetDelete);

  registerHandler('POST',   '/api/transfer-rules', handleTransferRuleCreate);
  registerHandler('PUT',    '/api/transfer-rules/:id', handleTransferRuleUpdate);
  registerHandler('PATCH',  '/api/transfer-rules/:id', handleTransferRuleUpdate);
  registerHandler('DELETE', '/api/transfer-rules/:id', handleTransferRuleDelete);

  registerHandler('POST',   '/api/tri/assign', handleTriAssign);
  registerHandler('POST',   '/api/recategorize', handleRecategorize);
  registerHandler('PATCH',  '/api/settings', handleSettingsPatch);
  registerHandler('GET',    '/api/backup/export', handleBackupExport);
}
