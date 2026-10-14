import type { Segment } from '../../../components/BalanceChart/lib';
import type { PlacementPoint } from './series';

type Xy = (i: number) => number;
type Y = (v: number) => number;

const f = (n: number) => n.toFixed(1);

// Versé is held constant until the next sample (contributions land on a
// date and stay), so it draws as a step: horizontal to the next x, then
// vertical to the new level.
export function buildStepPath(pts: PlacementPoint[], x: Xy, y: Y): string {
  let d = '';
  pts.forEach((p, i) => {
    if (i === 0) d = `M ${f(x(0))} ${f(y(p.contributed))}`;
    else d += ` H ${f(x(i))} V ${f(y(p.contributed))}`;
  });
  return d;
}

// Valeur line split into runs of equal dashing. A segment is dashed when
// either end is an estimate (interpolated / carried value).
export function buildValueSegments(pts: PlacementPoint[], x: Xy, y: Y): Segment[] {
  const out: Segment[] = [];
  if (pts.length < 2) return out;
  let d = `M ${f(x(0))} ${f(y(pts[0]!.value))}`;
  let dashed = pts[0]!.estimated || pts[1]!.estimated;
  for (let i = 1; i < pts.length; i++) {
    const segDashed = pts[i - 1]!.estimated || pts[i]!.estimated;
    if (segDashed !== dashed) {
      out.push({ d, dashed });
      d = `M ${f(x(i - 1))} ${f(y(pts[i - 1]!.value))}`;
      dashed = segDashed;
    }
    d += ` L ${f(x(i))} ${f(y(pts[i]!.value))}`;
  }
  out.push({ d, dashed });
  return out;
}

// Area between the Versé step and the Valeur line, one polygon per interval.
// On interval [i, i+1] Versé is flat at c_i, so the gap is linear from
// g0 = v_i - c_i to g1 = v_{i+1} - c_i. When it changes sign the interval
// splits into two triangles at the crossing. Returns SVG path data for the
// gain (>= 0) and loss (< 0) regions.
export function buildGainAreas(
  pts: PlacementPoint[],
  x: Xy,
  y: Y,
): { positive: string; negative: string } {
  let positive = '';
  let negative = '';
  const add = (sign: number, poly: Array<[number, number]>) => {
    const d = `M ${poly.map(([px, py]) => `${f(px)} ${f(py)}`).join(' L ')} Z`;
    if (sign >= 0) positive += ` ${d}`;
    else negative += ` ${d}`;
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const c = pts[i]!.contributed;
    const g0 = pts[i]!.value - c;
    const g1 = pts[i + 1]!.value - c;
    const x0 = x(i);
    const x1 = x(i + 1);
    const yc = y(c);
    if (g0 === 0 && g1 === 0) continue;
    if (g0 * g1 >= 0) {
      add(g0 !== 0 ? g0 : g1, [[x0, yc], [x1, yc], [x1, y(pts[i + 1]!.value)], [x0, y(pts[i]!.value)]]);
    } else {
      const xc = x0 + (x1 - x0) * (g0 / (g0 - g1));
      add(g0, [[x0, yc], [xc, yc], [x0, y(pts[i]!.value)]]);
      add(g1, [[xc, yc], [x1, yc], [x1, y(pts[i + 1]!.value)]]);
    }
  }
  return { positive: positive.trim(), negative: negative.trim() };
}

// Y domain over both lines with ~8 % headroom. Unlike the balance chart it
// does not force 0 into view: a 4 000 € portfolio should fill the plot.
export function computePlacementRange(pts: PlacementPoint[]): { minY: number; maxY: number; range: number } {
  const ys = pts.flatMap((p) => [p.value, p.contributed]);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || Math.max(Math.abs(hi), 1);
  const minY = lo - span * 0.08;
  const maxY = hi + span * 0.08;
  return { minY, maxY, range: maxY - minY };
}
