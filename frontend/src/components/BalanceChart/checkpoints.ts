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

// Attach each in-range checkpoint to its "actual" cumulative on that date.
// Banks aren't consistent about which balance they print on statement day D:
// some show start-of-day (before D's transactions), some show end-of-day
// (after). We compare the expected amount against BOTH and keep whichever
// matches better — so a checkpoint that lines up with either edge of the
// day does not falsely register drift. The diamond's X is a direct query
// of the caller-provided time-based scale, so the marker sits at the exact
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
      // Binary search for the latest bucket with bucket.date <= c.date
      // (end-of-day balance). Start-of-day = balance at the previous bucket
      // when the matched bucket is exactly c.date; otherwise the two are
      // equal (no transaction landed on that day).
      let lo = 0;
      let hi = data.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (data[mid]!.date <= c.date) lo = mid;
        else hi = mid - 1;
      }
      const endOfDay = data[lo]!.value;
      const startOfDay =
        data[lo]!.date === c.date && lo > 0 ? data[lo - 1]!.value : endOfDay;
      const deltaEnd = c.expectedAmount - endOfDay;
      const deltaStart = c.expectedAmount - startOfDay;
      const useStart = Math.abs(deltaStart) < Math.abs(deltaEnd);
      const actual = useStart ? startOfDay : endOfDay;
      const delta = useStart ? deltaStart : deltaEnd;
      const drift = Math.abs(delta) >= CHECKPOINT_TOLERANCE;
      const cx = xScale(c.date);
      return { ...c, actual, delta, drift, cx };
    });
}
