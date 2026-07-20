export interface Sample {
  date: string;
  value: number;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// A drag narrower than this (in viewBox units, out of 1000) is treated as
// a stray click, not a zoom request.
export const MIN_ZOOM_WIDTH_VB = 10;

export function isoDate(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export interface MergeInput {
  raw: Sample[];
  alignEndTo?: number;
  projection?: Array<{ date: string; value: number }>;
}

export interface MergeResult {
  data: Sample[];
  projectionStartIdx: number;
}

// Shift the historical curve to land on `alignEndTo` (paper-over for the
// /api/reports/timeseries under-count of inactive-in-window accounts), then
// append forward-dated projection samples (strictly `date > anchorDate`, so
// a stray past date can't disturb the historical segmentation).
export function mergeHistoricalAndProjection({ raw, alignEndTo, projection }: MergeInput): MergeResult {
  const shift =
    alignEndTo !== undefined && raw.length > 0
      ? alignEndTo - raw[raw.length - 1]!.value
      : 0;
  const historical =
    shift === 0 ? raw : raw.map((p) => ({ date: p.date, value: p.value + shift }));
  const anchorDate = historical.length > 0 ? historical[historical.length - 1]!.date : '';
  const forward = (projection ?? [])
    .filter((p) => p.date > anchorDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (forward.length === 0) {
    return { data: historical, projectionStartIdx: historical.length };
  }
  return {
    data: [...historical, ...forward],
    projectionStartIdx: historical.length,
  };
}

export interface YRange {
  minY: number;
  maxY: number;
  range: number;
}

export function computeYRange(data: Sample[]): YRange {
  const ys = data.map((d) => d.value);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 0);
  const range = maxY - minY || 1;
  return { minY, maxY, range };
}

export interface ActiveWindow {
  activeFirstMs: number;
  activeLastMs: number;
  xSpan: number;
}

export function computeActiveWindow(
  data: Sample[],
  zoom: { startMs: number; endMs: number } | null,
): ActiveWindow {
  const dataFirstMs = Date.parse(data[0]!.date);
  const dataLastMs = Date.parse(data[data.length - 1]!.date);
  const activeFirstMs = zoom?.startMs ?? dataFirstMs;
  const activeLastMs = zoom?.endMs ?? dataLastMs;
  const xSpan = Math.max(1, activeLastMs - activeFirstMs);
  return { activeFirstMs, activeLastMs, xSpan };
}

export interface Segment {
  d: string;
  dashed: boolean;
}

export interface BuildSegmentsInput {
  data: Sample[];
  projectionStartIdx: number;
  gapThresholdDays: number;
  xScaleAt: (i: number) => number;
  yScale: (v: number) => number;
}

// Split the stroked line into runs of consecutive segments sharing the same
// "dashed" verdict. Dashed when the two points bracket a gap greater than
// `gapThresholdDays` (missing data) OR when the segment enters the projection
// window (uncertain forward extension). Both read the same visually.
export function buildSegments({
  data,
  projectionStartIdx,
  gapThresholdDays,
  xScaleAt,
  yScale,
}: BuildSegmentsInput): Segment[] {
  const segments: Segment[] = [];
  if (data.length < 2) return segments;
  let runStart = 0;
  let runDashed: boolean | null = null;
  for (let i = 1; i < data.length; i++) {
    const gap = Math.round(
      (Date.parse(data[i]!.date) - Date.parse(data[i - 1]!.date)) / 86_400_000,
    );
    const isProjection = i >= projectionStartIdx;
    const dashed = isProjection || gap > gapThresholdDays;
    if (runDashed === null) {
      runDashed = dashed;
      continue;
    }
    if (dashed !== runDashed) {
      segments.push({
        d: data
          .slice(runStart, i)
          .map(
            (p, k) =>
              `${k === 0 ? 'M' : 'L'} ${xScaleAt(runStart + k).toFixed(1)} ${yScale(p.value).toFixed(1)}`,
          )
          .join(' '),
        dashed: runDashed,
      });
      runStart = i - 1;
      runDashed = dashed;
    }
  }
  segments.push({
    d: data
      .slice(runStart)
      .map(
        (p, k) =>
          `${k === 0 ? 'M' : 'L'} ${xScaleAt(runStart + k).toFixed(1)} ${yScale(p.value).toFixed(1)}`,
      )
      .join(' '),
    dashed: runDashed ?? false,
  });
  return segments;
}

export interface BuildAreaPathInput {
  data: Sample[];
  projectionStartIdx: number;
  xScaleAt: (i: number) => number;
  yScale: (v: number) => number;
  pad: Padding;
  innerH: number;
}

// Area fill covers only the historical portion — the projection stays
// stroke-only so the "uncertain" region reads visually different from
// the filled "measured" region.
export function buildAreaPath({
  data,
  projectionStartIdx,
  xScaleAt,
  yScale,
  pad,
  innerH,
}: BuildAreaPathInput): { historicalPath: string; areaPath: string } {
  const historicalPath = data
    .slice(0, projectionStartIdx)
    .map(
      (d, i) =>
        `${i === 0 ? 'M' : 'L'} ${xScaleAt(i).toFixed(1)} ${yScale(d.value).toFixed(1)}`,
    )
    .join(' ');
  if (projectionStartIdx <= 0) return { historicalPath, areaPath: '' };
  const historicalLastIdx = Math.max(0, projectionStartIdx - 1);
  const areaPath = `${historicalPath} L ${xScaleAt(historicalLastIdx).toFixed(1)} ${(pad.top + innerH).toFixed(1)} L ${xScaleAt(0).toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`;
  return { historicalPath, areaPath };
}

export interface AxisTicks {
  tickValues: number[];
  xTicks: string[];
}

export function buildAxisTicks(input: {
  minY: number;
  range: number;
  activeFirstMs: number;
  xSpan: number;
  dataLength: number;
  yTicks?: number;
}): AxisTicks {
  const yTicks = input.yTicks ?? 4;
  const tickValues = Array.from(
    { length: yTicks + 1 },
    (_, i) => input.minY + (input.range * i) / yTicks,
  );
  const xTickCount = Math.min(6, Math.max(2, input.dataLength));
  const xTicks: string[] = Array.from({ length: xTickCount }, (_, i) =>
    isoDate(input.activeFirstMs + (i * input.xSpan) / (xTickCount - 1)),
  );
  return { tickValues, xTicks };
}
