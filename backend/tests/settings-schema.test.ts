import { describe, it, expect } from 'vitest';
import { mergeSettings } from '../src/domain/settings/schema.js';
import { DEFAULTS } from '../src/domain/settings/defaults.js';

describe('mergeSettings', () => {
  it('returns DEFAULTS when stored is empty', () => {
    expect(mergeSettings({}, {})).toEqual(DEFAULTS);
  });

  it('overrides stored values with patch values', () => {
    const out = mergeSettings({ dashboardRange: '6m' }, { dashboardRange: '12m' });
    expect(out.dashboardRange).toBe('12m');
  });

  it('unknown keys in stored do not survive and known keys still apply on the wholesale fallback', () => {
    // Zod's default parse fails on unknown keys with .strict(), so the whole
    // blob falls back to DEFAULTS. Test 5 covers the same fallback behavior for
    // out-of-range values; this test locks in that an unknown key is one of
    // those triggers.
    const out = mergeSettings({ dashboardRange: '6m', bogus: 'x' } as any, {});
    expect(out).toEqual(DEFAULTS);
    expect((out as any).bogus).toBeUndefined();
  });

  it('falls back to defaults when stored is not an object', () => {
    expect(mergeSettings(null, {})).toEqual(DEFAULTS);
    expect(mergeSettings('nope', {})).toEqual(DEFAULTS);
  });

  it('ignores an invalid stored field by falling back to defaults for the whole blob', () => {
    // A single bad field currently makes the safeParse fail as a whole; we
    // treat that as "trust nothing" and return DEFAULTS. If future work
    // wants field-by-field recovery, that's a separate change.
    const out = mergeSettings({ chartGapThresholdDays: 9999 }, {});
    expect(out).toEqual(DEFAULTS);
  });

  it('defaults transactionsDefaultAccount to "first-checking"', () => {
    expect(mergeSettings({}, {}).transactionsDefaultAccount).toBe('first-checking');
  });

  it('accepts "all" for transactionsDefaultAccount', () => {
    expect(
      mergeSettings({ transactionsDefaultAccount: 'all' }, {}).transactionsDefaultAccount,
    ).toBe('all');
  });

  it('accepts a positive integer for transactionsDefaultAccount', () => {
    expect(
      mergeSettings({ transactionsDefaultAccount: 7 }, {}).transactionsDefaultAccount,
    ).toBe(7);
  });

  it('rejects 0 for transactionsDefaultAccount (falls back to defaults)', () => {
    const out = mergeSettings({ transactionsDefaultAccount: 0 }, {});
    expect(out.transactionsDefaultAccount).toBe('first-checking');
  });

  it('rejects an unknown string for transactionsDefaultAccount (falls back to defaults)', () => {
    const out = mergeSettings({ transactionsDefaultAccount: 'unknown' }, {});
    expect(out.transactionsDefaultAccount).toBe('first-checking');
  });
});
