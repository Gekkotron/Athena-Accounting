import { describe, it, expect } from 'vitest';
import {
  HORIZONS,
  contributingSeries,
  classifyEmpty,
  todayIso,
  isoDaysAgo,
} from '../forecast-lib';
import type { RecurringSeries } from '../../../api/types';

const series = (over: Partial<RecurringSeries>): RecurringSeries =>
  ({ id: 1, status: 'confirmed', ...over } as RecurringSeries);

describe('HORIZONS', () => {
  it('exposes the four canonical horizon lengths, in ascending order', () => {
    expect(HORIZONS).toEqual([30, 60, 90, 180]);
  });
});

describe('todayIso / isoDaysAgo', () => {
  it('todayIso returns a well-formed YYYY-MM-DD string', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('isoDaysAgo returns a date strictly earlier than todayIso for a positive count', () => {
    const past = isoDaysAgo(1);
    const now = todayIso();
    expect(past).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(past.localeCompare(now)).toBeLessThanOrEqual(0);
  });
});

describe('contributingSeries', () => {
  it('with includeDetected=false, keeps only confirmed', () => {
    const active = [series({ id: 1, status: 'confirmed' }), series({ id: 2, status: 'detected' })];
    expect(contributingSeries(active, false).map((s) => s.id)).toEqual([1]);
  });

  it('with includeDetected=true, keeps everything in the active list', () => {
    const active = [series({ id: 1, status: 'confirmed' }), series({ id: 2, status: 'detected' })];
    expect(contributingSeries(active, true).map((s) => s.id)).toEqual([1, 2]);
  });
});

describe('classifyEmpty', () => {
  it('returns null when the projection has any contributor', () => {
    expect(
      classifyEmpty({
        contributingCount: 1,
        scope: 'all',
        allUserSeriesCount: 5,
        activeSeriesCount: 5,
        includeDetected: false,
      }),
    ).toBeNull();
  });

  it('returns "scope" when contributors are zero, scope is narrowed, and user has other series overall', () => {
    expect(
      classifyEmpty({
        contributingCount: 0,
        scope: 3,
        allUserSeriesCount: 5,
        activeSeriesCount: 0,
        includeDetected: false,
      }),
    ).toBe('scope');
  });

  it('returns "unconfirmed" when contributors are zero, active is non-empty, and user is opted-out of detected', () => {
    expect(
      classifyEmpty({
        contributingCount: 0,
        scope: 'all',
        allUserSeriesCount: 5,
        activeSeriesCount: 5,
        includeDetected: false,
      }),
    ).toBe('unconfirmed');
  });

  it('returns "none" when neither scope narrowing nor unconfirmed detection explains the empty state', () => {
    expect(
      classifyEmpty({
        contributingCount: 0,
        scope: 'all',
        allUserSeriesCount: 0,
        activeSeriesCount: 0,
        includeDetected: false,
      }),
    ).toBe('none');
    expect(
      classifyEmpty({
        contributingCount: 0,
        scope: 'all',
        allUserSeriesCount: 3,
        activeSeriesCount: 0,
        includeDetected: true,
      }),
    ).toBe('none');
  });
});
