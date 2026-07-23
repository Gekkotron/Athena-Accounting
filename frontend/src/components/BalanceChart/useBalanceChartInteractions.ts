import { useRef, useState } from 'react';
import { MIN_ZOOM_WIDTH_VB } from './lib';

interface HoverState {
  idx: number;
  // viewBox X of the mouse itself (not the snapped bucket). Used to decide
  // whether the mouse is close enough to a checkpoint to show its drift in
  // the tooltip — under a time-based X, buckets near a checkpoint can still
  // be far in pixels if the surrounding data is sparse.
  mouseViewBoxX: number;
  // Container-relative coordinates of the snapped data point, used to
  // absolutely position the HTML tooltip so it tracks the point even when
  // the SVG is scaled to fit different container widths.
  x: number;
  y: number;
}

// Active brush drag in viewBox coordinates. The rectangle is drawn between
// `startVb` and `endVb`; on release, the range is committed as a zoom
// window (or discarded if too narrow to be intentional).
interface DragState {
  startVb: number;
  endVb: number;
}

export interface ZoomState {
  startMs: number;
  endMs: number;
}

interface SeriesPoint {
  date: string;
  value: number;
}

interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function useBalanceChartInteractions(config: {
  data: SeriesPoint[];
  xScaleAt: (i: number) => number;
  yScale: (v: number) => number;
  vbToMs: (vb: number) => number;
  w: number;
  h: number;
  pad: Padding;
  setZoom: (z: ZoomState | null) => void;
}) {
  const { data, xScaleAt, yScale, vbToMs, w, h, pad, setZoom } = config;
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const getViewBoxX = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * w;
  };

  const inPlotArea = (vbX: number): boolean => vbX >= pad.left && vbX <= w - pad.right;

  // Pointer down starts a brush drag when inside the plot area. Skipped on
  // touch so the OS scroll gesture wins on mobile.
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') return;
    const vbX = getViewBoxX(e.clientX);
    if (!inPlotArea(vbX)) return;
    setDrag({ startVb: vbX, endVb: vbX });
    (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
  };

  // Pointer move handler — updates the drag rect if a brush is active, and
  // always keeps the hover tooltip anchored to the nearest data point.
  const onMove = (e: React.MouseEvent<SVGSVGElement> | React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;
    const svgRect = svg.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const xInViewBox = ((e.clientX - svgRect.left) / svgRect.width) * w;

    if (drag !== null) {
      // Clamp the drag endpoint to the plot area so a fling into the
      // padding doesn't produce a useless zoom window.
      const clamped = Math.max(pad.left, Math.min(w - pad.right, xInViewBox));
      setDrag({ startVb: drag.startVb, endVb: clamped });
      return; // suppress hover updates while dragging — tooltip would flicker
    }

    // Snap only to buckets currently in the active window (their X sits in
    // the plot area). Under zoom, out-of-window buckets have X far outside
    // and are visually clipped — tooltiping them would be surprising.
    // Seed `closest` with the first in-plot bucket so a degenerate mouse
    // coord (e.g. NaN from jsdom's zero-size layout in tests) still lands
    // on something visible instead of dropping the tooltip.
    let closest = -1;
    for (let i = 0; i < data.length; i++) {
      const cx = xScaleAt(i);
      if (cx >= pad.left - 1 && cx <= w - pad.right + 1) { closest = i; break; }
    }
    if (closest < 0) {
      setHover(null);
      return;
    }
    let minDist = Math.abs(xScaleAt(closest) - xInViewBox);
    for (let i = closest + 1; i < data.length; i++) {
      const cx = xScaleAt(i);
      if (cx < pad.left - 1 || cx > w - pad.right + 1) continue;
      const dist = Math.abs(cx - xInViewBox);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }

    const px = (xScaleAt(closest) / w) * svgRect.width;
    const py = (yScale(data[closest]!.value) / h) * svgRect.height;

    setHover({
      idx: closest,
      mouseViewBoxX: xInViewBox,
      x: svgRect.left - containerRect.left + px,
      y: svgRect.top - containerRect.top + py,
    });
  };

  const commitZoomFromDrag = (d: DragState) => {
    const width = Math.abs(d.endVb - d.startVb);
    if (width < MIN_ZOOM_WIDTH_VB) return; // stray click — ignore
    const a = vbToMs(d.startVb);
    const b = vbToMs(d.endVb);
    setZoom({ startMs: Math.min(a, b), endMs: Math.max(a, b) });
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag !== null) {
      commitZoomFromDrag(drag);
      setDrag(null);
    }
    (e.currentTarget as SVGSVGElement).releasePointerCapture?.(e.pointerId);
  };

  const onPointerLeave = () => {
    setHover(null);
    // Keep `drag` active if the pointer is captured — the user can drag out
    // and back in. Pointer capture ensures we still receive the eventual
    // pointerup even when the pointer leaves the SVG bounds.
  };

  const dragRect =
    drag !== null && Math.abs(drag.endVb - drag.startVb) >= MIN_ZOOM_WIDTH_VB
      ? { x: Math.min(drag.startVb, drag.endVb), width: Math.abs(drag.endVb - drag.startVb) }
      : null;

  return {
    containerRef,
    svgRef,
    hover,
    drag,
    dragRect,
    onMove,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
  };
}
