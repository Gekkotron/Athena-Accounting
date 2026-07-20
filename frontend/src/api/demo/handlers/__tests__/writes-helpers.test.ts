import { describe, it, expect } from 'vitest';
import { nextId, matchesRule } from '../writes/lib';
import type { Rule, Transaction } from '../../../types';

describe('nextId', () => {
  it('returns 1 for an empty list', () => {
    expect(nextId([])).toBe(1);
  });

  it('returns max(id) + 1 for a contiguous list', () => {
    expect(nextId([{ id: 1 }, { id: 2 }, { id: 3 }])).toBe(4);
  });

  it('handles gaps in the id space (skipped ids stay skipped)', () => {
    expect(nextId([{ id: 3 }, { id: 10 }, { id: 7 }])).toBe(11);
  });
});

describe('matchesRule', () => {
  const tx = (over: Partial<Transaction>): Transaction =>
    ({
      id: 1,
      amount: '-10.00',
      rawLabel: 'CAFÉ CENTRAL',
      normalizedLabel: 'cafe central',
      ...over,
    } as Transaction);

  const rule = (over: Partial<Rule>): Rule =>
    ({
      id: 1,
      categoryId: 1,
      keyword: 'cafe',
      signConstraint: 'any',
      matchMode: 'substring',
      priority: 100,
      enabled: true,
      createdAt: new Date().toISOString(),
      ...over,
    } as Rule);

  it('returns false when the rule is disabled', () => {
    expect(matchesRule(tx({}), rule({ enabled: false }))).toBe(false);
  });

  it('substring mode matches case-insensitively on normalizedLabel', () => {
    expect(matchesRule(tx({}), rule({ keyword: 'CAFE' }))).toBe(true);
    expect(matchesRule(tx({}), rule({ keyword: 'notfound' }))).toBe(false);
  });

  it('regex mode matches case-insensitively on rawLabel', () => {
    expect(matchesRule(tx({}), rule({ matchMode: 'regex', keyword: 'café\\s+central' }))).toBe(true);
    expect(matchesRule(tx({}), rule({ matchMode: 'regex', keyword: '^spot' }))).toBe(false);
  });

  it('regex mode returns false on an invalid pattern instead of throwing', () => {
    expect(matchesRule(tx({}), rule({ matchMode: 'regex', keyword: '[unclosed' }))).toBe(false);
  });

  it('signConstraint=negative rejects positive-or-zero amounts', () => {
    expect(matchesRule(tx({ amount: '5.00' }), rule({ signConstraint: 'negative' }))).toBe(false);
    expect(matchesRule(tx({ amount: '0.00' }), rule({ signConstraint: 'negative' }))).toBe(false);
    expect(matchesRule(tx({ amount: '-5.00' }), rule({ signConstraint: 'negative' }))).toBe(true);
  });

  it('signConstraint=positive rejects negative-or-zero amounts', () => {
    expect(matchesRule(tx({ amount: '-5.00' }), rule({ signConstraint: 'positive' }))).toBe(false);
    expect(matchesRule(tx({ amount: '0.00' }), rule({ signConstraint: 'positive' }))).toBe(false);
    expect(matchesRule(tx({ amount: '5.00' }), rule({ signConstraint: 'positive' }))).toBe(true);
  });
});
