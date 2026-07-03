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

// Attach each in-range checkpoint to its "actual" cumulative on that date,
// using the same forward-fill semantics as the main series (latest bucket
// with bucket_date <= checkpointDate). Anything outside the plotted range
// is silently dropped — no orphan dots hanging off the edges.
export function buildCheckpointMarks(
  data: SeriesPoint[],
  checkpoints: Checkpoint[] | undefined,
  xScale: (i: number) => number,
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
      // Binary search for the latest bucket <= c.date.
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
      // Precompute the diamond's X position once. xScale spaces points by
      // ARRAY INDEX (bucket position), not by elapsed calendar time — buckets
      // are irregularly spaced (one per date with activity), so positioning
      // by a whole-range time-fraction would put the checkpoint at the wrong
      // index whenever bucket spacing is uneven. Instead, reuse the bucket
      // `lo` already found above and interpolate only within that single
      // bucket-to-next-bucket gap, by time, then map through xScale.
      let cx: number;
      if (lo >= data.length - 1) {
        cx = xScale(lo);
      } else {
        const loTime = new Date(data[lo]!.date).getTime();
        const nextTime = new Date(data[lo + 1]!.date).getTime();
        const span = nextTime - loTime;
        const frac = span > 0 ? (new Date(c.date).getTime() - loTime) / span : 0;
        cx = xScale(lo + frac);
      }
      return { ...c, actual, delta, drift, cx };
    });
}
