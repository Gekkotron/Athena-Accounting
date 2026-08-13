import type { Rule, Transaction } from '../../../types';
import { getState, setState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { matchesRule, nextId } from './lib';

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

// Dry run of a draft rule against the seed history — read-only mirror of the
// backend's POST /api/rules/preview.
function handleRulePreview(req: DemoRequest) {
  const body = (req.body ?? {}) as Partial<Rule>;
  const draft: Rule = {
    id: 0,
    categoryId: 0,
    keyword: body.keyword ?? '',
    signConstraint: body.signConstraint ?? 'any',
    matchMode: body.matchMode ?? 'word',
    priority: 0,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  const limit = 20;
  const hits = (getState().transactions as Transaction[])
    .filter((t) => matchesRule(t, draft))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return {
    matches: hits.slice(0, limit).map((t) => ({
      id: t.id, date: t.date, amount: t.amount,
      rawLabel: t.rawLabel, accountId: t.accountId,
    })),
    totalCount: hits.length,
    limit,
  };
}

export function registerRulesWriteHandlers(): void {
  registerHandler('POST', '/api/rules', handleRuleCreate);
  registerHandler('POST', '/api/rules/preview', handleRulePreview);
  registerHandler('PUT', '/api/rules/:id', handleRuleUpdate);
  registerHandler('PATCH', '/api/rules/:id', handleRuleUpdate);
  registerHandler('DELETE', '/api/rules/:id', handleRuleDelete);
}
