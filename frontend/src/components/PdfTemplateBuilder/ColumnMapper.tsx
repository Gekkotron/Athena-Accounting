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

const ROLE_SHORT: Record<ColumnRole, string> = {
  date: 'Date',
  amountSigned: 'Montant',
  debit: 'Débit',
  credit: 'Crédit',
  description: 'Libellé',
  ignore: '—',
};

// Tailwind tokens: sage-300 = #7dd3c0 (assigned), clay-300 = #e69782 (amount-ish),
// ink-700 = #272d3b (idle border), ink-500 = #5b6478 (idle text).
const ROLE_PAINT: Record<ColumnRole, { fill: string; stroke: string; text: string }> = {
  date:         { fill: 'rgba(125,211,192,0.18)', stroke: '#7dd3c0', text: '#7dd3c0' },
  description:  { fill: 'rgba(125,211,192,0.18)', stroke: '#7dd3c0', text: '#7dd3c0' },
  amountSigned: { fill: 'rgba(230,151,130,0.20)', stroke: '#e69782', text: '#e69782' },
  debit:        { fill: 'rgba(230,151,130,0.20)', stroke: '#e69782', text: '#e69782' },
  credit:       { fill: 'rgba(230,151,130,0.20)', stroke: '#e69782', text: '#e69782' },
  ignore:       { fill: 'rgba(124,132,147,0.08)', stroke: '#3a4252', text: '#7c8493' },
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

  // Tile the columns inside tableRect: every column ends where the next one
  // begins, so the overlay never paints over itself. The last column extends
  // to the right edge of tableRect.
  const tiled = useMemo(() => {
    const sorted = columns
      .map((c, originalIdx) => ({ ...c, originalIdx }))
      .sort((a, b) => a.xStart - b.xStart);
    const tableRight = tableRect.x + tableRect.w;
    return sorted.map((c, i, arr) => {
      const next = arr[i + 1];
      const right = next ? Math.max(next.xStart, c.xStart + 1) : tableRight;
      return { ...c, displayRight: Math.min(right, tableRight) };
    });
  }, [columns, tableRect.x, tableRect.w]);

  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv) return;
    const ctx = cnv.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, cnv.width, cnv.height);
      ctx.drawImage(img, 0, 0, cnv.width, cnv.height);
      const tableY = tableRect.y * displayScale;
      const tableH = tableRect.h * displayScale;
      ctx.lineWidth = 1.5;
      ctx.font = '600 11px "Hanken Grotesk Variable", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      tiled.forEach((c, idx) => {
        const x = c.xStart * displayScale;
        const w = (c.displayRight - c.xStart) * displayScale;
        const paint = ROLE_PAINT[c.role];
        ctx.fillStyle = paint.fill;
        ctx.fillRect(x, tableY, w, tableH);
        ctx.strokeStyle = paint.stroke;
        ctx.strokeRect(x, tableY, w, tableH);
        // Role label centered horizontally near the top of the column.
        ctx.fillStyle = paint.text;
        const labelY = tableY + 6;
        const cx = x + w / 2;
        ctx.fillText(ROLE_SHORT[c.role], cx, labelY);
        // Column index for cross-reference with the dropdown list below.
        ctx.fillStyle = paint.text;
        ctx.font = '500 9px "JetBrains Mono Variable", ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`#${idx + 1}`, x + 4, tableY + 4);
        ctx.font = '600 11px "Hanken Grotesk Variable", system-ui, sans-serif';
        ctx.textAlign = 'center';
      });
    };
    img.src = `data:image/png;base64,${pngBase64}`;
  }, [pngBase64, tiled, displayScale, tableRect]);

  const counts = useMemo(() => ({
    date: columns.filter((c) => c.role === 'date').length,
    description: columns.filter((c) => c.role === 'description').length,
    amountSigned: columns.filter((c) => c.role === 'amountSigned').length,
    debit: columns.filter((c) => c.role === 'debit').length,
    credit: columns.filter((c) => c.role === 'credit').length,
  }), [columns]);

  const requirements: Array<{ label: string; ok: boolean }> = [
    { label: '1 Date', ok: counts.date === 1 },
    { label: '1 Libellé', ok: counts.description === 1 },
    {
      label: '1 Montant signé OU 1 Débit + 1 Crédit',
      ok:
        (counts.amountSigned === 1 && counts.debit === 0 && counts.credit === 0) ||
        (counts.amountSigned === 0 && counts.debit === 1 && counts.credit === 1),
    },
  ];

  function setRole(idx: number, role: ColumnRole) {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, role } : c)));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="text-ink-400 uppercase tracking-wide">Requis :</span>
        {requirements.map((r) => (
          <span
            key={r.label}
            className={r.ok ? 'text-sage-300' : 'text-ink-300'}
          >
            {r.ok ? '✓' : '○'} {r.label}
          </span>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        width={widthPt * displayScale}
        height={heightPt * displayScale}
        className="rounded-lg border border-ink-700 max-w-full block"
      />
      <p className="mt-3 text-xs text-ink-400">
        Étiquetez chaque colonne ci-dessous. Le numéro <code className="font-mono text-ink-300">#n</code> correspond à celui affiché sur l'image.
      </p>
      <div className="mt-2 grid gap-1.5">
        {tiled.map((c) => (
          <div key={`${c.xStart}-${c.xEnd}`} className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink-400 min-w-[2.5rem]">
              #{tiled.indexOf(c) + 1}
            </span>
            <select
              value={c.role}
              onChange={(e) => setRole(c.originalIdx, e.target.value as ColumnRole)}
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
