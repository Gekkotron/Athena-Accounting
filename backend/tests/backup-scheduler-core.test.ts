import { describe, it, expect } from 'vitest';
import { isBackupDue } from '../src/domain/backup/scheduler.js';

// hour = 3 → occurrence at 03:00 local.
const at = (h: number, m = 0) => new Date(2026, 7, 5, h, m); // 2026-08-05 local

describe('isBackupDue', () => {
  it('never ran → always due', () => {
    expect(isBackupDue(3, at(4), null)).toBe(true);
  });
  it("ran after today's occurrence → not due", () => {
    expect(isBackupDue(3, at(9), at(3, 5))).toBe(false);
  });
  it('last success was yesterday and the hour has passed → due', () => {
    const yesterday = new Date(2026, 7, 4, 3, 5);
    expect(isBackupDue(3, at(4), yesterday)).toBe(true);
  });
  it('the hour has not come yet today and yesterday ran → not due', () => {
    const yesterday = new Date(2026, 7, 4, 3, 5);
    expect(isBackupDue(3, at(2), yesterday)).toBe(false);
  });
  it('a failed run (lastRunAt untouched) stays due on the next tick', () => {
    // failure semantics live in recordRun (lastRunAt only moves on success),
    // so dueness here is the same as "ran yesterday".
    expect(isBackupDue(3, at(4), new Date(2026, 7, 4, 3, 5))).toBe(true);
  });
});
