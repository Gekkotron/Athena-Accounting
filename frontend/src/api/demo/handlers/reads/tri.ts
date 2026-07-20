import type { TriGroup } from '../../../types';
import { registerHandler, type DemoRequest } from '../../index';
import { money, txs } from './lib';

function handleTriGroups(req: DemoRequest) {
  const limit = req.query.limit ? Number(req.query.limit) : 200;
  const offset = req.query.offset ? Number(req.query.offset) : 0;
  const perNorm = new Map<string, {
    normalized_label: string;
    transaction_count: number;
    total: number;
    example_raw_label: string;
    example_id: number;
    min_date: string;
    max_date: string;
  }>();
  for (const t of txs()) {
    if (t.categoryId != null) continue;
    const key = t.normalizedLabel || t.rawLabel.toLowerCase();
    const entry = perNorm.get(key) ?? {
      normalized_label: key,
      transaction_count: 0,
      total: 0,
      example_raw_label: t.rawLabel,
      example_id: t.id,
      min_date: t.date,
      max_date: t.date,
    };
    entry.transaction_count += 1;
    entry.total += Number(t.amount);
    if (t.date < entry.min_date) entry.min_date = t.date;
    if (t.date > entry.max_date) entry.max_date = t.date;
    perNorm.set(key, entry);
  }
  const all: TriGroup[] = Array.from(perNorm.values())
    .sort((a, b) => b.transaction_count - a.transaction_count)
    .map((v) => ({
      normalized_label: v.normalized_label,
      transaction_count: v.transaction_count,
      total_amount: money(v.total),
      example_raw_label: v.example_raw_label,
      example_id: v.example_id,
      min_date: v.min_date,
      max_date: v.max_date,
    }));
  return {
    groups: all.slice(offset, offset + limit),
    pagination: { total: all.length, limit, offset },
  };
}

export function registerTriHandlers(): void {
  registerHandler('GET', '/api/tri/groups', handleTriGroups);
}
