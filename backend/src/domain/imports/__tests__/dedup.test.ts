import { describe, expect, it } from 'vitest';
import { computeDedupKey, type DedupInput } from '../dedup.js';

const base: DedupInput = {
  accountId: 1,
  date: '2026-06-27',
  amount: '-25.30',
  normalizedLabel: 'carrefour',
};

describe('computeDedupKey', () => {
  it('is deterministic for identical rows', () => {
    expect(computeDedupKey(base)).toBe(computeDedupKey({ ...base }));
  });

  it('produces a prefixed sha1 hex hash without fitid', () => {
    expect(computeDedupKey(base)).toMatch(/^hash:[0-9a-f]{40}$/);
  });

  it.each([
    ['accountId', { accountId: 2 }],
    ['date', { date: '2026-06-28' }],
    ['amount', { amount: '-25.31' }],
    ['normalizedLabel', { normalizedLabel: 'leclerc' }],
  ])('changes when %s changes', (_name, patch) => {
    expect(computeDedupKey({ ...base, ...patch })).not.toBe(computeDedupKey(base));
  });

  it('does not treat near-matching amounts as equal', () => {
    expect(computeDedupKey({ ...base, amount: '-25.30' })).not.toBe(
      computeDedupKey({ ...base, amount: '-25.3' }),
    );
  });

  it('uses the trimmed fitid when present', () => {
    expect(computeDedupKey({ ...base, fitid: '  ABC123 ' })).toBe('fitid:ABC123');
  });

  it('ignores other fields when fitid is present', () => {
    const a = computeDedupKey({ ...base, fitid: 'X1' });
    const b = computeDedupKey({ ...base, accountId: 9, amount: '1.00', fitid: 'X1' });
    expect(a).toBe(b);
  });

  it.each([null, undefined, '', '   '])('falls back to hash for fitid %j', (fitid) => {
    expect(computeDedupKey({ ...base, fitid })).toBe(computeDedupKey(base));
  });

  it('gives same-day identical rows the same key', () => {
    expect(computeDedupKey({ ...base })).toBe(computeDedupKey({ ...base }));
  });
});
