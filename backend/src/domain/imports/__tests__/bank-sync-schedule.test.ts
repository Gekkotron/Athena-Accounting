import { describe, expect, it } from 'vitest';
import {
  isAutoSyncDue,
  lastScheduledOccurrence,
  nextScheduledOccurrence,
} from '../bank-sync-core.js';

// Local-time construction on purpose — the helpers are documented as
// machine-clock based, so the tests build dates the same way.
const at = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0);

describe('lastScheduledOccurrence', () => {
  it('is today when the hour already passed', () => {
    expect(lastScheduledOccurrence(2, at(2026, 8, 3, 10, 30))).toEqual(at(2026, 8, 3, 2));
  });

  it('is yesterday when the hour has not come yet', () => {
    expect(lastScheduledOccurrence(2, at(2026, 8, 3, 1, 59))).toEqual(at(2026, 8, 2, 2));
  });

  it('is now at the exact scheduled moment', () => {
    expect(lastScheduledOccurrence(2, at(2026, 8, 3, 2))).toEqual(at(2026, 8, 3, 2));
  });

  it('crosses month boundaries', () => {
    expect(lastScheduledOccurrence(23, at(2026, 8, 1, 0, 15))).toEqual(at(2026, 7, 31, 23));
  });
});

describe('nextScheduledOccurrence', () => {
  it('is tomorrow when the hour already passed', () => {
    expect(nextScheduledOccurrence(2, at(2026, 8, 3, 10, 30))).toEqual(at(2026, 8, 4, 2));
  });

  it('is later today when the hour is still ahead', () => {
    expect(nextScheduledOccurrence(2, at(2026, 8, 3, 1, 59))).toEqual(at(2026, 8, 3, 2));
  });
});

describe('isAutoSyncDue', () => {
  const now = at(2026, 8, 3, 10, 0);

  it('due when never attempted', () => {
    expect(isAutoSyncDue(2, now, undefined)).toBe(true);
  });

  it('not due again after an attempt past the occurrence', () => {
    expect(isAutoSyncDue(2, now, at(2026, 8, 3, 2, 5).getTime())).toBe(false);
  });

  it('due again once a new occurrence passes', () => {
    const yesterdayRun = at(2026, 8, 2, 2, 5).getTime();
    expect(isAutoSyncDue(2, now, yesterdayRun)).toBe(true);
  });

  it('not due before the first occurrence of the day when attempted yesterday', () => {
    const beforeHour = at(2026, 8, 3, 1, 0);
    expect(isAutoSyncDue(2, beforeHour, at(2026, 8, 2, 2, 10).getTime())).toBe(false);
  });
});
