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

  it('drops unknown keys in stored', () => {
    const out = mergeSettings({ dashboardRange: '3m', bogus: 'x' } as any, {});
    expect(out).toEqual({ ...DEFAULTS, dashboardRange: '3m' });
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
});
