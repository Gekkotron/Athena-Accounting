import { describe, it, expect } from 'vitest';
import { buildCheckpointMarks } from '../checkpoints';

const identityScale = (i: number) => i;

const seriesRange = [
  { date: '2024-01-01', value: 100 },
  { date: '2024-02-01', value: 110 },
  { date: '2024-03-01', value: 120 },
];

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

  it('interpolates cx between adjacent buckets by elapsed time', () => {
    // 2024-02-15 sits ~half-way between 2024-02-01 (idx 1) and 2024-03-01
    // (idx 2). With identity xScale, cx should be roughly 1.5.
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-02-15', expectedAmount: 200 }],
      identityScale,
    );
    expect(marks[0]!.cx).toBeGreaterThan(1);
    expect(marks[0]!.cx).toBeLessThan(2);
    // Feb 15 is 14 days past Feb 1, out of a 29-day Feb (2024 leap year) →
    // fraction ≈ 14/29 ≈ 0.483.
    expect(marks[0]!.cx).toBeCloseTo(1 + 14 / 29, 2);
  });

  it('clamps cx to the last bucket index when checkpoint equals the last date', () => {
    const marks = buildCheckpointMarks(
      seriesRange,
      [{ date: '2024-03-01', expectedAmount: 120 }],
      identityScale,
    );
    expect(marks[0]!.cx).toBe(2);
  });
});
