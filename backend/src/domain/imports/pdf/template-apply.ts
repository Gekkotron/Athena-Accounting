import type { PdfPageText, PdfTextItem } from './text-extract.js';
import type { TemplateZones } from './zones.js';
import type { ParsedTransaction } from '../ofx-parser.js';
import { tryParseFrenchDate, tryParseFrenchAmount } from '../french-numerics.js';
import { isBalanceLine, isFooterLine, mergeContinuationLabel, truncateLabel } from './label.js';

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

  // Page set:
  //   - explicit `selectedPages` wins (multi-account flow)
  //   - else legacy `tableRepeatsPerPage`: true = all pages, false = [0]
  const allPageIndices = pages.map((_, i) => i);
  const pageSet = new Set(
    zones.selectedPages && zones.selectedPages.length > 0
      ? zones.selectedPages
      : zones.tableRepeatsPerPage
      ? allPageIndices
      : [0],
  );

  for (let p = 0; p < pages.length; p++) {
    if (!pageSet.has(p)) continue;
    const page = pages[p]!;
    const tableItems = page.items.filter((i) =>
      i.xLeft >= zones.tableZone.x - 1 &&
      i.xLeft <= zones.tableZone.x + zones.tableZone.w &&
      i.yTop >= (p === Math.min(...pageSet) ? zones.rowsStartY : 0) &&
      i.yTop <= page.heightPt,
    );
    const rowClusters = clusterRows(tableItems);
    // Continuation tracking lives within a single page — cross-page continuations
    // are rare enough to drop, and page-boundary header rows would otherwise
    // get mis-attached to the previous page's last transaction.
    let pageLastRow: ParsedTransaction | null = null;
    for (const r of rowClusters) {
      const dateRaw = valueIn(r, dateCol.xStart, dateCol.xEnd);
      const descText = valueIn(r, descCol.xStart, descCol.xEnd);

      // Statement balance markers ("Solde créditeur au …", "Nouveau solde …")
      // and footer disclaimers ("Sous réserve des extournes …") sit inside
      // the table zone with no date; skip them entirely so they don't get
      // mis-attached to the last real transaction.
      if (isBalanceLine(descText) || isFooterLine(descText)) continue;

      if (!dateRaw) {
        // Row has no date in the date column. If it carries description text,
        // treat it as a wrapped continuation line of the previous transaction
        // (e.g. "CARTE 4964" under "MAGASIN U"). Otherwise it's a separator
        // or footer row — skip silently.
        if (descText && pageLastRow) {
          pageLastRow.rawLabel = mergeContinuationLabel(pageLastRow.rawLabel, descText);
        }
        continue;
      }
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

      const newRow: ParsedTransaction = {
        date,
        amount,
        rawLabel: truncateLabel(descText),
        memo: null,
        fitid: null,
      };
      rows.push(newRow);
      pageLastRow = newRow;
    }
  }
  return { rows, skippedRows: skipped };
}
