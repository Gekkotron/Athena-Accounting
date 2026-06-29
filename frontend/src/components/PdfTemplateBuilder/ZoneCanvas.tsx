import { useEffect, useRef, useState } from 'react';

export interface PageRect { x: number; y: number; w: number; h: number }

interface Props {
  pngBase64: string;
  widthPt: number;
  heightPt: number;
  initialRect: PageRect | null;
  displayMaxWidth?: number;
  onChange: (rect: PageRect) => void;
}

export function ZoneCanvas({
  pngBase64, widthPt, heightPt, initialRect, displayMaxWidth = 720, onChange,
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
    if (rect) {
      ctx.strokeStyle = '#0a84ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        rect.x * displayScale,
        rect.y * displayScale,
        rect.w * displayScale,
        rect.h * displayScale,
      );
      ctx.fillStyle = 'rgba(10,132,255,0.10)';
      ctx.fillRect(
        rect.x * displayScale,
        rect.y * displayScale,
        rect.w * displayScale,
        rect.h * displayScale,
      );
    }
  }, [imgReady, rect, displayScale]);

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
