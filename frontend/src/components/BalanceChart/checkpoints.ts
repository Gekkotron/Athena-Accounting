import type { SeriesPoint } from './series';

export interface Checkpoint {
  date: string;
  expectedAmount: number;
  note?: string;
}

export interface CheckpointMark extends Checkpoint {
  actual: number;
  delta: number;
  drift: boolean;
  cx: number;
}

const CHECKPOINT_TOLERANCE = 0.01;

// Attach each in-range checkpoint to its "actual" cumulative on that date
// (latest bucket with bucket_date <= checkpointDate — same forward-fill as
// the main series aggregation). The diamond's X is a direct query of the
// caller-provided time-based scale, so the marker sits at the exact
// calendar X regardless of how densely surrounding buckets are spaced.
export function buildCheckpointMarks(
  data: SeriesPoint[],
  checkpoints: Checkpoint[] | undefined,
  xScale: (date: string) => number,
): CheckpointMark[] {
  if (!checkpoints?.length || data.length === 0) return [];
  const firstDate = data[0]!.date;
  const lastDate = data[data.length - 1]!.date;
  return checkpoints
    .filter(
      (c) =>
        c.date >= firstDate &&
        c.date <= lastDate &&
        Number.isFinite(c.expectedAmount),
    )
    .map((c) => {
      // Binary search for the latest bucket <= c.date (used for "actual").
      let lo = 0;
      let hi = data.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (data[mid]!.date <= c.date) lo = mid;
        else hi = mid - 1;
      }
      const actual = data[lo]!.value;
      const delta = c.expectedAmount - actual;
      const drift = Math.abs(delta) >= CHECKPOINT_TOLERANCE;
      const cx = xScale(c.date);
      return { ...c, actual, delta, drift, cx };
    });
}
