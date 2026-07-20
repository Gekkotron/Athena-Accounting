import { describe, it, expect, vi } from 'vitest';
import { cleanupOrphanTipIds } from '../cleanup.js';

type Row = { userId: number; dismissedTips: Record<string, string> | null };

// Minimal fake — records both SELECT (scanned) and UPDATE (mutated) calls.
function makeFakeDb(rows: Row[]) {
  const updates: Array<{ userId: number; dismissedTips: Record<string, string> }> = [];
  return {
    updates,
    async select(): Promise<Row[]> { return rows; },
    async update(userId: number, dismissedTips: Record<string, string>): Promise<void> {
      updates.push({ userId, dismissedTips });
    },
  };
}

describe('cleanupOrphanTipIds', () => {
  it('drops keys not in the allowlist and rewrites the row', async () => {
    const fake = makeFakeDb([
      { userId: 1, dismissedTips: {
        'welcome_tour': '2026-01-01T00:00:00.000Z',
        'section:dashboard': '2026-01-02T00:00:00.000Z',
        'tour:dashboard': '2026-07-01T00:00:00.000Z',
      } },
    ]);
    const stats = await cleanupOrphanTipIds({
      select: () => fake.select(),
      updateDismissed: (userId, blob) => fake.update(userId, blob),
    });
    expect(stats.scanned).toBe(1);
    expect(stats.mutated).toBe(1);
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]!.userId).toBe(1);
    expect(fake.updates[0]!.dismissedTips).toEqual({
      'tour:dashboard': '2026-07-01T00:00:00.000Z',
    });
  });

  it('does not update rows that already contain only allowed ids', async () => {
    const fake = makeFakeDb([
      { userId: 2, dismissedTips: { 'tour:accounts': '2026-07-15T00:00:00.000Z' } },
    ]);
    const stats = await cleanupOrphanTipIds({
      select: () => fake.select(),
      updateDismissed: (userId, blob) => fake.update(userId, blob),
    });
    expect(stats.scanned).toBe(1);
    expect(stats.mutated).toBe(0);
    expect(fake.updates).toHaveLength(0);
  });

  it('deletes a jsonb blob down to {} if every key is orphaned', async () => {
    const fake = makeFakeDb([
      { userId: 3, dismissedTips: { 'welcome_tour': 'x', 'section:budgets': 'y' } },
    ]);
    const stats = await cleanupOrphanTipIds({
      select: () => fake.select(),
      updateDismissed: (userId, blob) => fake.update(userId, blob),
    });
    expect(stats.mutated).toBe(1);
    expect(fake.updates[0]!.dismissedTips).toEqual({});
  });

  it('skips rows with null dismissedTips', async () => {
    const fake = makeFakeDb([{ userId: 4, dismissedTips: null }]);
    const stats = await cleanupOrphanTipIds({
      select: () => fake.select(),
      updateDismissed: (userId, blob) => fake.update(userId, blob),
    });
    expect(stats.scanned).toBe(1);
    expect(stats.mutated).toBe(0);
  });
});
