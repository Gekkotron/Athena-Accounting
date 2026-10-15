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

  it('drops unknown keys in stored and keeps the known ones', () => {
    // Stored blobs parse non-strict, so a key from a removed setting (like
    // the reverted showUnrealizedGains) can't reset every other setting.
    const out = mergeSettings({ dashboardRange: '6m', showUnrealizedGains: true, bogus: 'x' } as any, {});
    expect(out).toEqual({ ...DEFAULTS, dashboardRange: '6m' });
    expect((out as any).bogus).toBeUndefined();
    expect(out).not.toHaveProperty('showUnrealizedGains');
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

describe('dashboardHiddenSections', () => {
  it('defaults to an empty list', () => {
    expect(mergeSettings({}, {}).dashboardHiddenSections).toEqual([]);
  });

  it('accepts a list of known section ids', () => {
    const out = mergeSettings({ dashboardHiddenSections: ['sankey', 'budget'] }, {});
    expect(out.dashboardHiddenSections).toEqual(['sankey', 'budget']);
  });

  it('dedups repeats stored by a bad client', () => {
    const out = mergeSettings({ dashboardHiddenSections: ['sankey', 'sankey', 'budget'] }, {});
    expect(out.dashboardHiddenSections).toEqual(['sankey', 'budget']);
  });

  it('drops unknown ids and keeps the rest of the stored blob', () => {
    const out = mergeSettings({ dashboardHiddenSections: ['nope', 'sankey'], showForecast: true }, {});
    expect(out.dashboardHiddenSections).toEqual(['sankey']);
    expect(out.showForecast).toBe(true);
  });

  it('does not share the array with DEFAULTS (callers can mutate safely)', () => {
    const a = mergeSettings({}, {}).dashboardHiddenSections;
    a.push('sankey');
    expect(mergeSettings({}, {}).dashboardHiddenSections).toEqual([]);
  });
});

describe('bankSyncHour', () => {
  it('defaults to 2', () => {
    expect(mergeSettings({}, {}).bankSyncHour).toBe(2);
  });

  it('accepts the full 0-23 range', () => {
    expect(mergeSettings({ bankSyncHour: 0 }, {}).bankSyncHour).toBe(0);
    expect(mergeSettings({ bankSyncHour: 23 }, {}).bankSyncHour).toBe(23);
  });

  it('rejects out-of-range or fractional hours (falls back to default)', () => {
    expect(mergeSettings({ bankSyncHour: -1 }, {}).bankSyncHour).toBe(2);
    expect(mergeSettings({ bankSyncHour: 24 }, {}).bankSyncHour).toBe(2);
    expect(mergeSettings({ bankSyncHour: 1.5 }, {}).bankSyncHour).toBe(2);
  });
});
