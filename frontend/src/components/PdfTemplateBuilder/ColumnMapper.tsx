import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnRole, PdfTextItem } from '../../api/pdf-templates.js';

export interface Column { xStart: number; xEnd: number; role: ColumnRole }

interface Props {
  pngBase64: string;
  widthPt: number;
  heightPt: number;
  textItems: PdfTextItem[];
  tableRect: { x: number; y: number; w: number; h: number };
  initialColumns: Column[] | null;
  displayMaxWidth?: number;
  onChange: (columns: Column[]) => void;
}

function inferColumns(textItems: PdfTextItem[], rect: { x: number; y: number; w: number; h: number }): Column[] {
  const itemsInRect = textItems.filter(
    (i) => i.xLeft >= rect.x && i.xLeft <= rect.x + rect.w &&
           i.yTop >= rect.y && i.yTop <= rect.y + rect.h,
  );
  const xs = [...new Set(itemsInRect.map((i) => Math.round(i.xLeft)))].sort((a, b) => a - b);
  if (xs.length === 0) return [];
  const clusters: Array<{ xStart: number; xEnd: number }> = [{ xStart: xs[0]!, xEnd: xs[0]! }];
  for (const x of xs.slice(1)) {
    const last = clusters[clusters.length - 1]!;
    if (x - last.xEnd <= 15) last.xEnd = x;
    else clusters.push({ xStart: x, xEnd: x });
  }
  return clusters.map((c) => ({ xStart: c.xStart, xEnd: c.xEnd + 50, role: 'ignore' as ColumnRole }));
}

const ROLE_LABELS: Record<ColumnRole, string> = {
  date: 'Date',
  amountSigned: 'Montant (signé)',
  debit: 'Débit',
  credit: 'Crédit',
  description: 'Libellé',
  ignore: 'Ignorer',
};

export function ColumnMapper({
  pngBase64, widthPt, heightPt, textItems, tableRect, initialColumns,
  displayMaxWidth = 720, onChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detected = useMemo(
    () => initialColumns ?? inferColumns(textItems, tableRect),
    [initialColumns, textItems, tableRect],
  );
  const [columns, setColumns] = useState<Column[]>(detected);
  const displayScale = Math.min(1, displayMaxWidth / widthPt);

  useEffect(() => { setColumns(detected); }, [detected]);
  useEffect(() => { onChange(columns); }, [columns, onChange]);

  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv) return;
    const ctx = cnv.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, cnv.width, cnv.height);
      ctx.drawImage(img, 0, 0, cnv.width, cnv.height);
      ctx.strokeStyle = '#0a84ff';
      ctx.fillStyle = 'rgba(10,132,255,0.06)';
      ctx.lineWidth = 1.5;
      for (const c of columns) {
        ctx.fillRect(c.xStart * displayScale, tableRect.y * displayScale,
          (c.xEnd - c.xStart) * displayScale, tableRect.h * displayScale);
        ctx.strokeRect(c.xStart * displayScale, tableRect.y * displayScale,
          (c.xEnd - c.xStart) * displayScale, tableRect.h * displayScale);
      }
    };
    img.src = `data:image/png;base64,${pngBase64}`;
  }, [pngBase64, columns, displayScale, tableRect]);

  function setRole(idx: number, role: ColumnRole) {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, role } : c)));
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={widthPt * displayScale}
        height={heightPt * displayScale}
        className="rounded-lg border border-ink-700 max-w-full block"
      />
      <div className="mt-3 grid gap-1.5">
        {columns.map((c, i) => (
          <div key={`${c.xStart}-${c.xEnd}`} className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink-400 min-w-[6.5rem]">
              x {Math.round(c.xStart)}–{Math.round(c.xEnd)}
            </span>
            <select
              value={c.role}
              onChange={(e) => setRole(i, e.target.value as ColumnRole)}
              className="rounded-lg border border-ink-700 bg-ink-850 text-ink-100 px-2 py-1 text-sm focus:border-sage-300 focus:outline-none transition"
            >
              {(Object.keys(ROLE_LABELS) as ColumnRole[]).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
