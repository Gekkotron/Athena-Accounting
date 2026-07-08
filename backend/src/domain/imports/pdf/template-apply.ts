import type { PdfPageText, PdfTextItem } from './text-extract.js';
import type { TemplateZones } from './zones.js';
import type { ParsedTransaction } from '../ofx-parser.js';
import { tryParseFrenchDate, tryParseFrenchAmount } from '../french-numerics.js';
import { isBalanceLine, isFooterLine, mergeContinuationLabel, truncateLabel } from './label.js';
import { pageContainsAnchor, firstOtherAnchorY } from './page-anchor.js';

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

  // Page selection precedence:
  //   1. `pageAnchor` (content-based) — scan every page, keep those carrying
  //      the anchor line. Resilient to statements with a different total
  //      page count than the template's sample.
  //   2. `selectedPages` (absolute indices) — legacy fallback for templates
  //      saved before pageAnchor existed. Also emits a heads-up when the
  //      imported PDF is larger than the sample so silent drops surface.
  //   3. `tableRepeatsPerPage`: true → all pages, false → only page 0.
  const allPageIndices = pages.map((_, i) => i);
  let pageSet: Set<number>;
  if (zones.pageAnchor && zones.pageAnchor.trim().length > 0) {
    pageSet = new Set(
      pages.filter((p) => pageContainsAnchor(p, zones.pageAnchor!)).map((p) => p.pageIndex),
    );
  } else if (zones.selectedPages && zones.selectedPages.length > 0) {
    pageSet = new Set(zones.selectedPages);
    const maxSelected = Math.max(...zones.selectedPages);
    if (pages.length > maxSelected + 1) {
      const excess = allPageIndices.filter((i) => i > maxSelected);
      const pretty = excess.map((i) => i + 1).join(', ');
      skipped.push({
        rowText: `Page(s) ${pretty} non traitée(s)`,
        reason:
          'Ce template a été créé sur un PDF plus court ; il utilise des numéros de page absolus. ' +
          'Recréez-le pour un filtrage par contenu (marqueur automatique).',
      });
    }
  } else if (zones.tableRepeatsPerPage) {
    pageSet = new Set(allPageIndices);
  } else {
    pageSet = new Set([0]);
  }
  if (pageSet.size === 0) return { rows, skippedRows: skipped };

  for (let p = 0; p < pages.length; p++) {
    if (!pageSet.has(p)) continue;
    const page = pages[p]!;
    // Mid-page account boundary: if this page carries our anchor AND also
    // carries a marker for another account further down, cut off row
    // processing at that marker's Y. Rows on this page above the marker
    // are ours; everything from there down belongs to a different account.
    // Guard against a bogus otherAnchor whose yTop sits at or above the
    // transaction table's start Y — that would shrink the row window to
    // zero. Fall back to "no cutoff" in that case, so a mis-derivation
    // never zero-rows the import.
    const rawCutoffY = zones.otherAnchors && zones.otherAnchors.length > 0
      ? firstOtherAnchorY(page, zones.otherAnchors)
      : null;
    const cutoffY = rawCutoffY !== null && rawCutoffY > zones.rowsStartY ? rawCutoffY : null;
    const yUpperBound = cutoffY !== null ? Math.min(cutoffY, page.heightPt) : page.heightPt;
    const tableItems = page.items.filter((i) =>
      i.xLeft >= zones.tableZone.x - 1 &&
      i.xLeft <= zones.tableZone.x + zones.tableZone.w &&
      i.yTop >= (p === Math.min(...pageSet) ? zones.rowsStartY : 0) &&
      i.yTop <= yUpperBound,
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
        // (e.g. "CARTE 4964" under "MAGASIN U").
        if (descText && pageLastRow) {
          pageLastRow.rawLabel = mergeContinuationLabel(pageLastRow.rawLabel, descText);
        } else if (!descText && r.items.length > 0) {
          // The row has text inside the table zone, but neither the date nor
          // the description column captured any of it — the columns don't
          // line up with the content (misdrawn/misaligned zones). Surface it
          // so the user gets feedback instead of a silently empty preview.
          const rowText = r.items.map((i) => i.str).join(' ');
          skipped.push({ rowText, reason: 'aucune colonne ne correspond au contenu de la ligne' });
        }
        // else: genuine separator/blank row (or an orphan continuation with
        // no preceding transaction) — skip silently.
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
