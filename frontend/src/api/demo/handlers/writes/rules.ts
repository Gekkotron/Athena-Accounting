import type { Rule, TransferRule } from '../../../types';
import { getState, setState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { nextId } from './lib';

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

export function registerRulesWriteHandlers(): void {
  registerHandler('POST', '/api/rules', handleRuleCreate);
  registerHandler('PUT', '/api/rules/:id', handleRuleUpdate);
  registerHandler('PATCH', '/api/rules/:id', handleRuleUpdate);
  registerHandler('DELETE', '/api/rules/:id', handleRuleDelete);

  registerHandler('POST', '/api/transfer-rules', handleTransferRuleCreate);
  registerHandler('PUT', '/api/transfer-rules/:id', handleTransferRuleUpdate);
  registerHandler('PATCH', '/api/transfer-rules/:id', handleTransferRuleUpdate);
  registerHandler('DELETE', '/api/transfer-rules/:id', handleTransferRuleDelete);
}
