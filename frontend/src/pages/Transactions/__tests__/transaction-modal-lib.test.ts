import { describe, it, expect } from 'vitest';
import {
  buildPatchDiff,
  parseLockYearsInput,
  draftMatchesInitial,
} from '../transaction-modal-lib';
import type { Transaction } from '../../../api/types';
import type { DraftSplit } from '../SplitEditor';

const originalTx = (over: Partial<Transaction> = {}): Transaction =>
  ({
    id: 1,
    accountId: 10,
    date: '2026-07-15',
    amount: '-42.00',
    rawLabel: 'CAFÉ CENTRAL',
    categoryId: 5,
    notes: 'lunch',
    lockYears: null,
    splits: [],
    ...over,
  } as Transaction);

describe('parseLockYearsInput', () => {
  it('blank input returns { ok, value: null } (inherit account default)', () => {
    expect(parseLockYearsInput('')).toEqual({ ok: true, value: null });
    expect(parseLockYearsInput('   ')).toEqual({ ok: true, value: null });
  });

  it('accepts integers in [0, 99]', () => {
    expect(parseLockYearsInput('0')).toEqual({ ok: true, value: 0 });
    expect(parseLockYearsInput('5')).toEqual({ ok: true, value: 5 });
    expect(parseLockYearsInput('99')).toEqual({ ok: true, value: 99 });
  });

  it('rejects out-of-range, non-integer, or non-numeric', () => {
    expect(parseLockYearsInput('-1')).toEqual({ ok: false });
    expect(parseLockYearsInput('100')).toEqual({ ok: false });
    expect(parseLockYearsInput('3.5')).toEqual({ ok: false });
    expect(parseLockYearsInput('abc')).toEqual({ ok: false });
  });
});

describe('buildPatchDiff', () => {
  const base = () => ({
    accountId: 10,
    isoDate: '2026-07-15',
    amount: '-42.00',
    rawLabel: 'CAFÉ CENTRAL',
    categoryId: 5 as number | '',
    notes: 'lunch',
    lockYears: null as number | null,
  });

  it('returns an empty patch when nothing changed', () => {
    expect(buildPatchDiff(originalTx(), base())).toEqual({});
  });

  it('emits only the fields that actually changed', () => {
    const p = buildPatchDiff(originalTx(), { ...base(), amount: '-50.00' });
    expect(p).toEqual({ amount: '-50.00' });
  });

  it('trims rawLabel before comparing so pure-whitespace edits produce no field', () => {
    const p = buildPatchDiff(originalTx({ rawLabel: 'CAFÉ' }), { ...base(), rawLabel: '  CAFÉ  ' });
    expect(p).toEqual({});
  });

  it('normalises empty categoryId ("") to null so it lines up with the DB shape', () => {
    const p = buildPatchDiff(originalTx({ categoryId: null }), { ...base(), categoryId: '' });
    expect(p).toEqual({});
    const p2 = buildPatchDiff(originalTx({ categoryId: 5 }), { ...base(), categoryId: '' });
    expect(p2).toEqual({ categoryId: null });
  });

  it('trims notes and treats "" as null', () => {
    const p = buildPatchDiff(originalTx({ notes: null }), { ...base(), notes: '   ' });
    expect(p).toEqual({});
    const p2 = buildPatchDiff(originalTx({ notes: 'old' }), { ...base(), notes: 'new' });
    expect(p2).toEqual({ notes: 'new' });
  });

  it('compares lockYears null-vs-null as equal (both mean "inherit")', () => {
    const p = buildPatchDiff(originalTx({ lockYears: null }), { ...base(), lockYears: null });
    expect(p).toEqual({});
  });

  it('slices the original date to YYYY-MM-DD before comparing so an ISO-with-time original still matches', () => {
    const p = buildPatchDiff(
      originalTx({ date: '2026-07-15T00:00:00.000Z' }),
      { ...base(), isoDate: '2026-07-15' },
    );
    expect(p).toEqual({});
  });
});

describe('draftMatchesInitial', () => {
  const draft = (
    categoryId: number | '',
    amountMagnitude: string,
    memo = '',
    key = 'k',
  ): DraftSplit => ({ key, categoryId, amountMagnitude, memo });

  it('true when the draft matches initial byte-for-byte', () => {
    const initial = [
      { id: 1, transactionId: 1, categoryId: 5, amount: '-10.00', memo: null },
      { id: 2, transactionId: 1, categoryId: 6, amount: '-32.00', memo: 'coffee' },
    ];
    const drafted = [draft(5, '10.00'), draft(6, '32.00', 'coffee')];
    expect(draftMatchesInitial(drafted, initial, -4200)).toBe(true);
  });

  it('false when a row has an empty categoryId (still-being-edited draft)', () => {
    const initial = [{ id: 1, transactionId: 1, categoryId: 5, amount: '-10.00', memo: null }];
    const drafted = [draft('', '10.00')];
    expect(draftMatchesInitial(drafted, initial, -1000)).toBe(false);
  });

  it('false when lengths differ (row added or removed)', () => {
    expect(draftMatchesInitial([], [{ id: 1, transactionId: 1, categoryId: 5, amount: '-10.00', memo: null }], -1000)).toBe(false);
  });

  it('false when a categoryId or amount cent-count differs', () => {
    const initial = [{ id: 1, transactionId: 1, categoryId: 5, amount: '-10.00', memo: null }];
    expect(draftMatchesInitial([draft(6, '10.00')], initial, -1000)).toBe(false);
    expect(draftMatchesInitial([draft(5, '10.01')], initial, -1000)).toBe(false);
  });

  it('treats an empty memo (whitespace-only) as equivalent to a null initial memo', () => {
    const initial = [{ id: 1, transactionId: 1, categoryId: 5, amount: '-10.00', memo: null }];
    expect(draftMatchesInitial([draft(5, '10.00', '   ')], initial, -1000)).toBe(true);
  });
});
