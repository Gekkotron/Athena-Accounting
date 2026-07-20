import { describe, it, expect } from 'vitest';
import {
  money,
  bucketFor,
  monthOf,
  addDaysIso,
  nextDueFrom,
  computePrimaryAccountId,
  parseTxFilters,
  applyTxFilters,
  enrichAccount,
} from '../reads/lib';
import type { Account, Transaction } from '../../../types';

describe('money', () => {
  it('formats positive with two decimals', () => {
    expect(money(1)).toBe('1.00');
    expect(money(12.345)).toBe('12.35');
  });

  it('formats zero without a sign', () => {
    expect(money(0)).toBe('0.00');
    expect(money(-0)).toBe('0.00');
  });

  it('formats negatives with a leading minus and absolute-value magnitude', () => {
    expect(money(-1.5)).toBe('-1.50');
    // A tiny negative rounds to 0.00 in magnitude but the sign prefix stays.
    // Existing behaviour of the demo formatter; documented via this test.
    expect(money(-0.001)).toBe('-0.00');
  });
});

describe('bucketFor', () => {
  it('returns the ISO date for day granularity', () => {
    expect(bucketFor('2026-07-20', 'day')).toBe('2026-07-20');
  });

  it('returns the YYYY-MM prefix for month granularity', () => {
    expect(bucketFor('2026-07-20', 'month')).toBe('2026-07');
  });

  it('snaps to the Monday of the ISO week for week granularity', () => {
    // 2026-07-20 is a Monday — should return itself.
    expect(bucketFor('2026-07-20', 'week')).toBe('2026-07-20');
    // 2026-07-22 (Wednesday) → 2026-07-20 (Monday).
    expect(bucketFor('2026-07-22', 'week')).toBe('2026-07-20');
    // 2026-07-19 (Sunday) → still 2026-07-13 (previous Monday).
    expect(bucketFor('2026-07-19', 'week')).toBe('2026-07-13');
  });
});

describe('monthOf', () => {
  it('slices the first 7 chars', () => {
    expect(monthOf('2026-07-20')).toBe('2026-07');
  });
});

describe('addDaysIso', () => {
  it('adds a positive count', () => {
    expect(addDaysIso('2026-07-20', 5)).toBe('2026-07-25');
  });

  it('rolls over month and year boundaries correctly', () => {
    expect(addDaysIso('2026-07-30', 5)).toBe('2026-08-04');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('accepts negative counts', () => {
    expect(addDaysIso('2026-07-05', -10)).toBe('2026-06-25');
  });
});

describe('nextDueFrom', () => {
  it('returns lastSeen when it is already at or after today', () => {
    expect(nextDueFrom('2026-07-20', 30, '2026-07-15')).toBe('2026-07-20');
    expect(nextDueFrom('2026-07-15', 30, '2026-07-15')).toBe('2026-07-15');
  });

  it('walks forward in cadence-day steps until reaching today', () => {
    // lastSeen 2026-05-01, cadence 30, today 2026-07-15 → 2026-05-31 (still <) → 2026-06-30 (still <) → 2026-07-30
    expect(nextDueFrom('2026-05-01', 30, '2026-07-15')).toBe('2026-07-30');
  });
});

describe('computePrimaryAccountId', () => {
  const tx = (accountId: number, rawLabel: string): Transaction =>
    ({ accountId, rawLabel } as Transaction);

  it('returns null when no transactions match the label', () => {
    expect(computePrimaryAccountId('SPOTIFY', [tx(1, 'NETFLIX')])).toBeNull();
  });

  it('returns the sole account when matches come from only one', () => {
    expect(computePrimaryAccountId('SPOTIFY', [tx(3, 'SPOTIFY'), tx(3, 'SPOTIFY')])).toBe(3);
  });

  it('returns the majority-vote account', () => {
    const txs = [tx(1, 'SPOTIFY'), tx(2, 'SPOTIFY'), tx(2, 'SPOTIFY'), tx(3, 'OTHER')];
    expect(computePrimaryAccountId('SPOTIFY', txs)).toBe(2);
  });
});

describe('parseTxFilters', () => {
  it('parses accountId, from, to, q (lowercased), limit, offset', () => {
    const r = parseTxFilters({
      accountId: '3',
      from: '2026-07-01',
      to: '2026-07-31',
      q: 'CAFÉ',
      limit: '25',
      offset: '50',
    });
    expect(r.filters).toEqual({ accountId: 3, from: '2026-07-01', to: '2026-07-31', q: 'café' });
    expect(r.limit).toBe(25);
    expect(r.offset).toBe(50);
  });

  it('routes categoryId=null or uncategorized=true to the uncategorized flag', () => {
    expect(parseTxFilters({ categoryId: 'null' }).filters).toEqual({ uncategorized: true });
    expect(parseTxFilters({ uncategorized: 'true' }).filters).toEqual({ uncategorized: true });
  });

  it('routes a numeric categoryId to filters.categoryId', () => {
    expect(parseTxFilters({ categoryId: '7' }).filters).toEqual({ categoryId: 7 });
  });

  it('clamps limit into [1, 500] and offset into [0, ∞)', () => {
    expect(parseTxFilters({ limit: '9999' }).limit).toBe(500);
    expect(parseTxFilters({ limit: '0' }).limit).toBe(1);
    expect(parseTxFilters({ offset: '-5' }).offset).toBe(0);
  });

  it('falls back to defaults when limit/offset are absent', () => {
    const r = parseTxFilters({});
    expect(r.limit).toBe(50);
    expect(r.offset).toBe(0);
  });
});

describe('applyTxFilters', () => {
  const t = (over: Partial<Transaction>): Transaction =>
    ({
      id: 1,
      accountId: 1,
      date: '2026-07-15',
      amount: '-10.00',
      rawLabel: 'CAFÉ CENTRAL',
      normalizedLabel: 'cafe central',
      categoryId: null,
      ...over,
    } as Transaction);

  const list: Transaction[] = [
    t({ id: 1, accountId: 1, date: '2026-07-15', rawLabel: 'CAFÉ CENTRAL', normalizedLabel: 'cafe central', categoryId: null }),
    t({ id: 2, accountId: 2, date: '2026-07-20', rawLabel: 'SPOTIFY', normalizedLabel: 'spotify', categoryId: 5 }),
    t({ id: 3, accountId: 1, date: '2026-06-01', rawLabel: 'BOULANGERIE', normalizedLabel: 'boulangerie', categoryId: 5 }),
  ];

  it('filters by accountId', () => {
    expect(applyTxFilters(list, { accountId: 2 }).map((t) => t.id)).toEqual([2]);
  });

  it('filters by from + to (inclusive)', () => {
    expect(applyTxFilters(list, { from: '2026-07-01', to: '2026-07-31' }).map((t) => t.id)).toEqual([1, 2]);
  });

  it('filters by uncategorized', () => {
    expect(applyTxFilters(list, { uncategorized: true }).map((t) => t.id)).toEqual([1]);
  });

  it('filters by categoryId', () => {
    expect(applyTxFilters(list, { categoryId: 5 }).map((t) => t.id)).toEqual([2, 3]);
  });

  it('filters by q (case-insensitive substring on rawLabel or normalizedLabel)', () => {
    expect(applyTxFilters(list, { q: 'café' }).map((t) => t.id)).toEqual([1]);
    expect(applyTxFilters(list, { q: 'spot' }).map((t) => t.id)).toEqual([2]);
  });
});

describe('enrichAccount', () => {
  const acc = (over: Partial<Account>): Account =>
    ({ id: 1, openingBalance: '100.00', openingDate: '2026-07-01', currency: 'EUR', type: 'checking', ...over } as Account);

  const tx = (over: Partial<Transaction>): Transaction =>
    ({ id: 1, accountId: 1, date: '2026-07-15', amount: '0.00', ...over } as Transaction);

  it('adds counted post-openingDate deltas to openingBalance', () => {
    const r = enrichAccount(acc({}), [
      tx({ id: 1, amount: '50.00' }),
      tx({ id: 2, amount: '-20.00' }),
    ]);
    expect(r.currentBalance).toBe('130.00');
  });

  it('counts only transactions on or after openingDate for the balance sum', () => {
    const r = enrichAccount(acc({ openingDate: '2026-07-10' }), [
      tx({ id: 1, date: '2026-06-25', amount: '999.00' }), // pre-opening — ignored
      tx({ id: 2, date: '2026-07-15', amount: '50.00' }),
    ]);
    expect(r.currentBalance).toBe('150.00');
  });

  it('splits transactionCount (raw for this account) from countedTransactionCount (post-openingDate)', () => {
    const r = enrichAccount(acc({ openingDate: '2026-07-10' }), [
      tx({ id: 1, date: '2026-06-25', amount: '10.00' }),
      tx({ id: 2, date: '2026-07-15', amount: '20.00' }),
      tx({ id: 3, accountId: 99, date: '2026-07-20', amount: '30.00' }), // other account
    ]);
    expect(r.transactionCount).toBe(2);
    expect(r.countedTransactionCount).toBe(1);
  });

  it('mirrors currentBalance into availableBalance in demo mode', () => {
    const r = enrichAccount(acc({}), [tx({ amount: '50.00' })]);
    expect(r.availableBalance).toBe(r.currentBalance);
  });
});
