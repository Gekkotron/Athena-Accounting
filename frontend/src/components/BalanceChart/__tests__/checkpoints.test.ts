import { describe, it, expect } from 'vitest';
import { buildCheckpointMarks } from '../checkpoints';

const seriesRange = [
  { date: '2024-01-01', value: 100 },
  { date: '2024-02-01', value: 110 },
  { date: '2024-03-01', value: 120 },
];

// Time-based identity-in-days scale: `xScale(date)` returns the number of
// days between `date` and the first bucket's date. This lets the tests
// assert exact calendar positions without dragging in the viewBox constants.
const daysSince = (start: string) => (date: string) =>
  (Date.parse(date) - Date.parse(start)) / 86_400_000;
const identityScale = daysSince(seriesRange[0]!.date);

describe('buildCheckpointMarks', () => {
  it('returns [] when there are no checkpoints', () => {
    expect(buildCheckpointMarks(seriesRange, undefined, identityScale)).toEqual([]);
    expect(buildCheckpointMarks(seriesRange, [], identityScale)).toEqual([]);
  });

  it('returns [] when data is empty', () => {
    expect(buildCheckpointMarks([], [{ date: '2024-01-01', expectedAmount: 100 }], identityScale))
      .toEqual([]);
  });

  it('drops checkpoints outside the plotted date range', () => {
    const marks = buildCheckpointMarks(
      seriesRange,
      [
        { date: '2023-12-01', expectedAmount: 100 }, // before start → dropped
        { date: '2024-05-01', expectedAmount: 100 }, // after end → dropped
        { date: '2024-02-01', expectedAmount: 110 }, // inside → kept
      ],
      identityScale,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]!.date).toBe('2024-02-01');
  });

  it('drops checkpoints with non-finite expectedAmount', () => {
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-02-01', expectedAmount: Number.NaN }],
      identityScale,
    );
    expect(marks).toEqual([]);
  });

  it('marks drift=false and delta≈0 when the actual matches expected', () => {
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-02-01', expectedAmount: 110 }],
      identityScale,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]!.actual).toBe(110);
    expect(marks[0]!.delta).toBe(0);
    expect(marks[0]!.drift).toBe(false);
  });

  it('marks drift=true and computes delta when actual != expected', () => {
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-02-01', expectedAmount: 150 }],
      identityScale,
    );
    expect(marks[0]!.actual).toBe(110);
    expect(marks[0]!.delta).toBe(40); // expected − actual
    expect(marks[0]!.drift).toBe(true);
  });

  it('binary-searches to the latest bucket <= checkpoint date (forward-fill semantics)', () => {
    // Checkpoint dated 2024-02-15 falls between the 02-01 and 03-01 buckets;
    // the "actual" must snap to 02-01 (the most-recent completed bucket at
    // that point in time), same forward-fill as the series aggregation.
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-02-15', expectedAmount: 200 }],
      identityScale,
    );
    expect(marks[0]!.actual).toBe(110); // = value at 2024-02-01
  });

  it('places cx at the checkpoint\'s exact calendar date (not interpolated between buckets)', () => {
    // 2024-02-15 is 45 days after 2024-01-01. With the daysSince scale the
    // exact cx is 45 — no dependency on bucket density around the checkpoint.
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-02-15', expectedAmount: 200 }],
      identityScale,
    );
    expect(marks[0]!.cx).toBe(45);
  });

  it('places cx on the first bucket when the checkpoint equals the first date', () => {
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-01-01', expectedAmount: 100 }],
      identityScale,
    );
    expect(marks[0]!.cx).toBe(0);
  });

  it('places cx on the last bucket when the checkpoint equals the last date', () => {
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-03-01', expectedAmount: 120 }],
      identityScale,
    );
    // Jan 1 → Mar 1 = 31 (Jan) + 29 (Feb 2024, leap) = 60 days.
    expect(marks[0]!.cx).toBe(60);
  });

  // Bank statements sometimes print the start-of-day balance (before the
  // day's transactions), sometimes the end-of-day balance (after). We take
  // whichever matches the checkpoint better, so a genuine reconciliation
  // doesn't light up as drift purely because of the day's own transactions.
  it('matches the start-of-day balance when the day has a transaction', () => {
    // Day 02-01 moved balance 100 → 110 (a +10 transaction). A checkpoint
    // at 02-01 equal to the previous bucket (100) is a start-of-day match.
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-02-01', expectedAmount: 100 }],
      identityScale,
    );
    expect(marks[0]!.actual).toBe(100);
    expect(marks[0]!.delta).toBe(0);
    expect(marks[0]!.drift).toBe(false);
  });

  it('still matches end-of-day when that fits better than start-of-day', () => {
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-02-01', expectedAmount: 110 }],
      identityScale,
    );
    expect(marks[0]!.actual).toBe(110);
    expect(marks[0]!.delta).toBe(0);
    expect(marks[0]!.drift).toBe(false);
  });

  it('drifts against the closer edge when neither start- nor end-of-day matches', () => {
    // End-of-day = 110, start-of-day = 100. Expected 130 is closer to 110
    // (delta 20) than to 100 (delta 30), so drift is reported vs. 110.
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-02-01', expectedAmount: 130 }],
      identityScale,
    );
    expect(marks[0]!.actual).toBe(110);
    expect(marks[0]!.delta).toBe(20);
    expect(marks[0]!.drift).toBe(true);
  });

  it('falls back to end-of-day when the checkpoint sits on the very first bucket', () => {
    // No previous bucket exists → nothing to compare start-of-day against.
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-01-01', expectedAmount: 100 }],
      identityScale,
    );
    expect(marks[0]!.actual).toBe(100);
    expect(marks[0]!.delta).toBe(0);
    expect(marks[0]!.drift).toBe(false);
  });
});
