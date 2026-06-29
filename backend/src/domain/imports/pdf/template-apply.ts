import type { PdfPageText, PdfTextItem } from './text-extract.js';
import type { TemplateZones, ColumnRole } from './zones.js';
import type { ParsedTransaction } from '../ofx-parser.js';
import { tryParseFrenchDate, tryParseFrenchAmount } from '../french-numerics.js';

export interface ApplyResult {
  rows: ParsedTransaction[];
  skippedRows: Array<{ rowText: string; reason: string }>;
}

const ROW_Y_TOLERANCE_PT = 2;

function clusterRows(items: PdfTextItem[]): Array<{ yTop: number; items: PdfTextItem[] }> {
  const sorted = [...items].sort((a, b) => a.yTop - b.yTop);
  const rows: Array<{ yTop: number; items: PdfTextItem[] }> = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.yTop - last.yTop) <= ROW_Y_TOLERANCE_PT) last.items.push(it);
    else rows.push({ yTop: it.yTop, items: [it] });
  }
  return rows;
}

// xEnd is already the column boundary — no extra padding to avoid bleed into adjacent columns.
function valueIn(row: { items: PdfTextItem[] }, xStart: number, xEnd: number): string {
  return row.items
    .filter((i) => i.xLeft >= xStart - 1 && i.xLeft <= xEnd)
    .sort((a, b) => a.xLeft - b.xLeft)
    .map((i) => i.str)
    .join(' ')
    .trim();
}

export function applyTemplate(pages: PdfPageText[], zones: TemplateZones): ApplyResult {
  const dateCol = zones.columns.find((c) => c.role === 'date');
  const descCol = zones.columns.find((c) => c.role === 'description');
  const signedCol = zones.columns.find((c) => c.role === 'amountSigned');
  const debitCol = zones.columns.find((c) => c.role === 'debit');
  const creditCol = zones.columns.find((c) => c.role === 'credit');
  if (!dateCol || !descCol) throw new Error('template: missing date/description column');

  const rows: ParsedTransaction[] = [];
  const skipped: Array<{ rowText: string; reason: string }> = [];

  for (let p = 0; p < pages.length; p++) {
    if (p > 0 && !zones.tableRepeatsPerPage) break;
    const page = pages[p]!;
    const tableItems = page.items.filter((i) =>
      i.xLeft >= zones.tableZone.x - 1 &&
      i.xLeft <= zones.tableZone.x + zones.tableZone.w &&
      i.yTop >= (p === 0 ? zones.rowsStartY : 0) &&
      i.yTop <= page.heightPt,
    );
    const rowClusters = clusterRows(tableItems);
    for (const r of rowClusters) {
      const dateRaw = valueIn(r, dateCol.xStart, dateCol.xEnd);
      if (!dateRaw) continue;
      const rowText = r.items.map((i) => i.str).join(' ');
      const date = tryParseFrenchDate(dateRaw);
      if (!date) { skipped.push({ rowText, reason: `unparseable date "${dateRaw}"` }); continue; }

      let amount: string | null = null;
      if (signedCol) {
        const raw = valueIn(r, signedCol.xStart, signedCol.xEnd);
        amount = tryParseFrenchAmount(raw);
        if (!amount) { skipped.push({ rowText, reason: `unparseable amount "${raw}"` }); continue; }
      } else if (debitCol && creditCol) {
        const d = valueIn(r, debitCol.xStart, debitCol.xEnd);
        const c = valueIn(r, creditCol.xStart, creditCol.xEnd);
        if (d) {
          const n = tryParseFrenchAmount(d);
          if (!n) { skipped.push({ rowText, reason: `unparseable debit "${d}"` }); continue; }
          amount = n.startsWith('-') ? n : `-${n}`;
        } else if (c) {
          const n = tryParseFrenchAmount(c);
          if (!n) { skipped.push({ rowText, reason: `unparseable credit "${c}"` }); continue; }
          amount = n;
        } else {
          continue;
        }
      } else {
        throw new Error('template: invalid amount column configuration');
      }

      const rawLabel = valueIn(r, descCol.xStart, descCol.xEnd);
      rows.push({ date, amount, rawLabel, memo: null, fitid: null });
    }
  }
  return { rows, skippedRows: skipped };
}
