import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fromDateFor } from '../RangePicker';

// Month-labeled ranges must be calendar-month based, not fixed day counts.
// A trailing 180-day window starting "today − 180d" chops off the start of
// the oldest month (a salary landing on the 1st silently vanished from the
// donut/Sankey), making the widgets disagree with the Moyennes tiles.
describe('fromDateFor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('6m starts on the 1st of the month 5 months back (current month counts as the 6th)', () => {
    vi.setSystemTime(new Date(2026, 7, 3)); // 2026-08-03 local
    expect(fromDateFor('6m')).toBe('2026-03-01');
  });

  it('3m starts on the 1st of the month 2 months back', () => {
    vi.setSystemTime(new Date(2026, 7, 3));
    expect(fromDateFor('3m')).toBe('2026-06-01');
  });

  it('12m starts on the 1st of the month 11 months back', () => {
    vi.setSystemTime(new Date(2026, 7, 3));
    expect(fromDateFor('12m')).toBe('2025-09-01');
  });

  it('month ranges wrap across year boundaries', () => {
    vi.setSystemTime(new Date(2026, 0, 15)); // 2026-01-15
    expect(fromDateFor('6m')).toBe('2025-08-01');
    expect(fromDateFor('12m')).toBe('2025-02-01');
  });

  it('30d stays a plain trailing-days window', () => {
    vi.setSystemTime(new Date(2026, 7, 3));
    expect(fromDateFor('30d')).toBe('2026-07-04');
  });

  it('all has no lower bound', () => {
    expect(fromDateFor('all')).toBeUndefined();
  });
});
