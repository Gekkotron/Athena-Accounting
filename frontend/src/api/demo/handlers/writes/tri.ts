import type { Transaction } from '../../../types';
import { setState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { matchesRule, nextId } from './lib';

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

export function registerTriWriteHandlers(): void {
  registerHandler('POST', '/api/tri/assign', handleTriAssign);
  registerHandler('POST', '/api/recategorize', handleRecategorize);
}
