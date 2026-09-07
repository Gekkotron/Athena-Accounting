import { describe, it, expect } from 'vitest';
import type { Account, BalancePoint } from '../../../api/types';
import { accountUnlockDate, filterToAvailableOverTime, isAccountAvailable } from '../helpers';

function acc(partial: Partial<Account> & Pick<Account, 'id' | 'openingDate'>): Account {
  return {
    name: `Account ${partial.id}`,
    type: 'checking',
    currency: 'EUR',
    openingBalance: '0',
    ...partial,
  } as Account;
}

function pt(account_id: number, bucket: string, cumulative: string): BalancePoint {
  return { account_id, currency: 'EUR', bucket, delta: '0', cumulative } as BalancePoint;
}

describe('isAccountAvailable', () => {
  it('returns true when there is no lock', () => {
    expect(isAccountAvailable(acc({ id: 1, openingDate: '2020-01-01' }))).toBe(true);
  });

  it('returns true once the lock window has elapsed', () => {
    const a = acc({ id: 1, openingDate: '2020-01-01', lockYears: 3 });
    expect(isAccountAvailable(a, new Date('2024-01-01T00:00:00Z'))).toBe(true);
  });

  it('returns false while still locked', () => {
    const a = acc({ id: 1, openingDate: '2020-01-01', lockYears: 5 });
    expect(isAccountAvailable(a, new Date('2024-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('accountUnlockDate', () => {
  it('is null for an unlocked account', () => {
    expect(accountUnlockDate(acc({ id: 1, openingDate: '2020-01-01' }))).toBeNull();
  });
  it('shifts the opening date by lockYears', () => {
    expect(accountUnlockDate(acc({ id: 1, openingDate: '2020-06-15', lockYears: 5 }))).toBe('2025-06-15');
  });
});

describe('filterToAvailableOverTime', () => {
  it('keeps every point for an unlocked account untouched', () => {
    const a = acc({ id: 1, openingDate: '2020-01-01' });
    const pts = [pt(1, '2020-01-01', '100'), pt(1, '2021-01-01', '150')];
    expect(filterToAvailableOverTime(pts, [a])).toEqual(pts);
  });

  it('drops pre-unlock buckets on a locked account and keeps post-unlock ones', () => {
    const a = acc({ id: 2, openingDate: '2020-06-15', lockYears: 5 });
    const preOpen = pt(2, '2020-06-15', '1000');
    const preInterest = pt(2, '2022-01-01', '1050');
    const atUnlock = pt(2, '2025-06-15', '1100');
    const post = pt(2, '2026-01-01', '1105');
    const out = filterToAvailableOverTime([preOpen, preInterest, atUnlock, post], [a]);
    expect(out).toEqual([atUnlock, post]);
  });

  it('injects a zero-delta baseline at the unlock date when no point lands there (sparse livret)', () => {
    // Livret opened 2020-06-15, locked 5 years, only two interest deposits
    // pre-unlock, then dormant — no post-unlock BalancePoint at all.
    const a = acc({ id: 3, openingDate: '2020-06-15', lockYears: 5 });
    const opening = pt(3, '2020-06-15', '200');
    const interest = pt(3, '2022-01-01', '210');
    const out = filterToAvailableOverTime([opening, interest], [a]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      account_id: 3,
      bucket: '2025-06-15',
      cumulative: '210', // last pre-unlock cumulative carries into the baseline
      delta: '0',
    });
  });

  it('does not double-inject when a post-unlock point already exists on the unlock date', () => {
    const a = acc({ id: 4, openingDate: '2020-06-15', lockYears: 5 });
    const pre = pt(4, '2020-06-15', '500');
    const atUnlock = pt(4, '2025-06-15', '525');
    const out = filterToAvailableOverTime([pre, atUnlock], [a]);
    expect(out).toEqual([atUnlock]);
  });

  it('handles a mix of locked and unlocked accounts in the same input', () => {
    const unlocked = acc({ id: 10, openingDate: '2020-01-01' });
    const locked = acc({ id: 11, openingDate: '2020-01-01', lockYears: 3 });
    const pts = [
      pt(10, '2020-01-01', '1000'),
      pt(11, '2020-01-01', '500'), // pre-unlock, dropped
      pt(11, '2023-01-01', '550'), // at unlock, kept
      pt(10, '2024-01-01', '1200'),
    ];
    const out = filterToAvailableOverTime(pts, [unlocked, locked]);
    expect(out).toHaveLength(3);
    expect(out.some((p) => p.bucket === '2020-01-01' && p.account_id === 11)).toBe(false);
    expect(out.some((p) => p.bucket === '2023-01-01' && p.account_id === 11)).toBe(true);
  });
});
