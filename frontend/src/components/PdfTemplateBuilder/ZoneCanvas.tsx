import { useEffect, useRef, useState } from 'react';

export interface PageRect { x: number; y: number; w: number; h: number }

interface Props {
  pngBase64: string;
  widthPt: number;
  heightPt: number;
  initialRect: PageRect | null;
  displayMaxWidth?: number;
  // Optional context rectangles drawn as dashed outlines underneath the
  // user's paint rectangle. Used in the column-painting steps to show
  // where the table zone lives, so the user has a target to draw inside.
  referenceRects?: Array<{ rect: PageRect; label?: string; color?: string }>;
  // Color used for the user's painted rectangle. Defaults to sage-300.
  paintColor?: string;
  onChange: (rect: PageRect) => void;
}

export function ZoneCanvas({
  pngBase64, widthPt, heightPt, initialRect, displayMaxWidth = 720,
  referenceRects, paintColor = '#7dd3c0', onChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [rect, setRect] = useState<PageRect | null>(initialRect);
  const [drag, setDrag] = useState<{ x0: number; y0: number } | null>(null);
  const displayScale = Math.min(1, displayMaxWidth / widthPt);
  const displayWidth = widthPt * displayScale;
  const displayHeight = heightPt * displayScale;

  useEffect(() => {
    setImgReady(false);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgReady(true);
    };
    img.src = `data:image/png;base64,${pngBase64}`;
  }, [pngBase64]);

  useEffect(() => {
    const cnv = canvasRef.current;
    const img = imgRef.current;
    if (!cnv || !img || !imgReady) return;
    const ctx = cnv.getContext('2d')!;
    ctx.clearRect(0, 0, cnv.width, cnv.height);
    ctx.drawImage(img, 0, 0, cnv.width, cnv.height);

    // Reference rectangles (dashed, behind the user's paint).
    if (referenceRects) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.font = '600 11px "Hanken Grotesk Variable", system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      for (const r of referenceRects) {
        const color = r.color ?? '#5b6478';
        ctx.strokeStyle = color;
        ctx.fillStyle = `${color}1a`; // ~10% alpha
        ctx.fillRect(
          r.rect.x * displayScale,
          r.rect.y * displayScale,
          r.rect.w * displayScale,
          r.rect.h * displayScale,
        );
        ctx.strokeRect(
          r.rect.x * displayScale,
          r.rect.y * displayScale,
          r.rect.w * displayScale,
          r.rect.h * displayScale,
        );
        if (r.label) {
          ctx.fillStyle = color;
          ctx.fillText(
            r.label,
            r.rect.x * displayScale + 4,
            r.rect.y * displayScale - 2,
          );
        }
      }
      ctx.restore();
    }

    // User's painted rectangle (solid stroke + fill).
    if (rect) {
      ctx.strokeStyle = paintColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        rect.x * displayScale,
        rect.y * displayScale,
        rect.w * displayScale,
        rect.h * displayScale,
      );
      ctx.fillStyle = `${paintColor}33`; // ~20% alpha
      ctx.fillRect(
        rect.x * displayScale,
        rect.y * displayScale,
        rect.w * displayScale,
        rect.h * displayScale,
      );
    }
  }, [imgReady, rect, displayScale, referenceRects, paintColor]);

  function toPagePt(ev: React.MouseEvent): { x: number; y: number } {
    const cnv = canvasRef.current!;
    const r = cnv.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / displayScale,
      y: (ev.clientY - r.top) / displayScale,
    };
  }

  function onMouseDown(ev: React.MouseEvent) {
    const p = toPagePt(ev);
    setDrag({ x0: p.x, y0: p.y });
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  function onMouseMove(ev: React.MouseEvent) {
    if (!drag) return;
    const p = toPagePt(ev);
    const next: PageRect = {
      x: Math.min(drag.x0, p.x),
      y: Math.min(drag.y0, p.y),
      w: Math.abs(p.x - drag.x0),
      h: Math.abs(p.y - drag.y0),
    };
    setRect(next);
  }
  function onMouseUp() {
    if (drag && rect && rect.w > 5 && rect.h > 5) onChange(rect);
    setDrag(null);
  }

  return (
    <canvas
      ref={canvasRef}
      width={displayWidth}
      height={displayHeight}
      style={{ border: '1px solid #272d3b', borderRadius: 8, cursor: 'crosshair', maxWidth: '100%', display: 'block' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    />
  );
}
