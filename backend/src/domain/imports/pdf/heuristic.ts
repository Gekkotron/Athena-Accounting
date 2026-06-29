import type { PdfPageText, PdfTextItem } from './text-extract.js';
import type { TemplateZones, ColumnRole, ZoneRect } from './zones.js';
import type { ParsedTransaction } from '../ofx-parser.js';
import { tryParseFrenchDate, tryParseFrenchAmount } from '../french-numerics.js';
import { isBalanceLine, mergeContinuationLabel, truncateLabel } from './label.js';

export interface HeuristicResult {
  zones: TemplateZones | null;
  rows: ParsedTransaction[];
  confidence: number;
  skippedRows: Array<{ rowText: string; reason: string }>;
}

const ROW_Y_TOLERANCE_PT = 2;        // group items into a row when their yTop differs by ≤ this
const DATE_RE = /^\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{2}|\d{4})$/;
const AMOUNT_RE = /^-?\d{1,3}(?:[  ]\d{3})*,\d{2}$/;

interface Row {
  yTop: number;
  items: PdfTextItem[];
}

function clusterRows(items: PdfTextItem[]): Row[] {
  const sorted = [...items].sort((a, b) => a.yTop - b.yTop);
  const rows: Row[] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.yTop - last.yTop) <= ROW_Y_TOLERANCE_PT) {
      last.items.push(it);
    } else {
      rows.push({ yTop: it.yTop, items: [it] });
    }
  }
  for (const r of rows) r.items.sort((a, b) => a.xLeft - b.xLeft);
  return rows;
}

interface ColumnCluster {
  xStart: number;
  xEnd: number;
  values: string[];
}

function clusterColumns(rows: Row[]): ColumnCluster[] {
  const xPoints = rows.flatMap((r) => r.items.map((i) => i.xLeft)).sort((a, b) => a - b);
  if (xPoints.length === 0) return [];
  const clusters: Array<{ xStart: number; xEnd: number }> = [{ xStart: xPoints[0]!, xEnd: xPoints[0]! }];
  for (const x of xPoints.slice(1)) {
    const last = clusters[clusters.length - 1]!;
    if (x - last.xEnd <= 15) last.xEnd = x;
    else clusters.push({ xStart: x, xEnd: x });
  }
  return clusters.map((c) => ({
    xStart: c.xStart,
    xEnd: c.xEnd + 50,
    values: rows.map((r) => {
      const inCol = r.items.filter((i) => i.xLeft >= c.xStart - 1 && i.xLeft <= c.xEnd + 50);
      return inCol.map((i) => i.str).join(' ').trim();
    }),
  }));
}

function fractionMatching(values: string[], re: RegExp): number {
  if (values.length === 0) return 0;
  const matches = values.filter((v) => re.test(v.trim())).length;
  return matches / values.length;
}

function inferColumnRoles(cols: ColumnCluster[]): Array<{ xStart: number; xEnd: number; role: ColumnRole }> | null {
  // Identify data rows: rows where at least one column has a date or amount value.
  // This excludes header rows (e.g. "Date", "Débit", "Montant") from fraction denominators.
  const rowCount = cols[0]?.values.length ?? 0;
  const dataRowIndices = Array.from({ length: rowCount }, (_, i) => i).filter((i) =>
    cols.some((c) => DATE_RE.test((c.values[i] ?? '').trim()) || AMOUNT_RE.test(c.values[i] ?? '')),
  );

  // Date column: fraction of data-row values matching DATE_RE >= 0.8
  let dateIdx = -1;
  let bestDate = 0;
  cols.forEach((c, idx) => {
    const dataVals = dataRowIndices.map((i) => c.values[i] ?? '');
    if (dataVals.length === 0) return;
    const matches = dataVals.filter((v) => DATE_RE.test(v.trim())).length;
    const f = matches / dataVals.length;
    if (f >= 0.8 && f > bestDate) { bestDate = f; dateIdx = idx; }
  });
  if (dateIdx === -1) return null;

  // Amount column(s): fraction matching AMOUNT_RE >= 0.6 (allows blanks in débit/crédit pair)
  const amountCandidates: number[] = [];
  cols.forEach((c, idx) => {
    if (idx === dateIdx) return;
    const dataVals = dataRowIndices.map((i) => c.values[i] ?? '');
    const nonEmpty = dataVals.filter((v) => v !== '').length;
    if (nonEmpty === 0) return;
    const matches = dataVals.filter((v) => AMOUNT_RE.test(v)).length;
    if (matches / Math.max(nonEmpty, 1) >= 0.6) amountCandidates.push(idx);
  });

  let signedIdx = -1;
  let debitIdx = -1, creditIdx = -1;
  if (amountCandidates.length === 1) {
    signedIdx = amountCandidates[0]!;
  } else if (amountCandidates.length >= 2) {
    // Pick the two whose populated rows are mutually exclusive (débit/crédit pair).
    const pairs: Array<[number, number, number]> = [];     // [i, j, exclusivity score]
    for (let i = 0; i < amountCandidates.length; i++) {
      for (let j = i + 1; j < amountCandidates.length; j++) {
        const a = cols[amountCandidates[i]!]!.values;
        const b = cols[amountCandidates[j]!]!.values;
        let both = 0, either = 0;
        for (let k = 0; k < a.length; k++) {
          const pa = AMOUNT_RE.test(a[k] ?? '');
          const pb = AMOUNT_RE.test(b[k] ?? '');
          if (pa && pb) both++;
          if (pa || pb) either++;
        }
        const exclusivity = either === 0 ? 0 : 1 - both / either;
        pairs.push([amountCandidates[i]!, amountCandidates[j]!, exclusivity]);
      }
    }
    pairs.sort((p, q) => q[2] - p[2]);
    const best = pairs[0]!;
    if (best[2] >= 0.8) {
      // débit is the leftmost of the pair
      [debitIdx, creditIdx] = best[0]! < best[1]! ? [best[0]!, best[1]!] : [best[1]!, best[0]!];
    } else {
      signedIdx = amountCandidates[0]!;
    }
  } else {
    return null;
  }

  // Description = widest remaining column
  const used = new Set([dateIdx, signedIdx, debitIdx, creditIdx].filter((i) => i >= 0));
  let descIdx = -1;
  let widest = 0;
  cols.forEach((c, idx) => {
    if (used.has(idx)) return;
    const w = c.xEnd - c.xStart;
    if (w > widest) { widest = w; descIdx = idx; }
  });
  if (descIdx === -1) return null;

  const out: Array<{ xStart: number; xEnd: number; role: ColumnRole }> = [];
  cols.forEach((c, idx) => {
    let role: ColumnRole = 'ignore';
    if (idx === dateIdx) role = 'date';
    else if (idx === signedIdx) role = 'amountSigned';
    else if (idx === debitIdx) role = 'debit';
    else if (idx === creditIdx) role = 'credit';
    else if (idx === descIdx) role = 'description';
    out.push({ xStart: c.xStart, xEnd: c.xEnd, role });
  });
  return out;
}

function findRowsStartY(rows: Row[], dateColIdx: number): number {
  // First row whose date-column value parses as a date.
  for (const r of rows) {
    const text = r.items[dateColIdx]?.str ?? '';
    if (DATE_RE.test(text.trim())) return r.yTop - 1;
  }
  return rows[0]?.yTop ?? 0;
}

function valueInColumn(row: Row, col: { xStart: number; xEnd: number }): string {
  return row.items
    .filter((i) => i.xLeft >= col.xStart - 1 && i.xLeft <= col.xEnd)
    .map((i) => i.str)
    .join(' ')
    .trim();
}

function extractRows(
  rows: Row[],
  columns: Array<{ xStart: number; xEnd: number; role: ColumnRole }>,
): {
  parsed: ParsedTransaction[];
  skipped: Array<{ rowText: string; reason: string }>;
  dateRowCount: number; // rows whose date column was non-empty — used as the confidence denominator
} {
  const dateCol = columns.find((c) => c.role === 'date')!;
  const descCol = columns.find((c) => c.role === 'description')!;
  const signedCol = columns.find((c) => c.role === 'amountSigned');
  const debitCol = columns.find((c) => c.role === 'debit');
  const creditCol = columns.find((c) => c.role === 'credit');

  const parsed: ParsedTransaction[] = [];
  const skipped: Array<{ rowText: string; reason: string }> = [];
  // Continuation tracking: a row with no date but a description text
  // ("CARTE 4964" under "MAGASIN U", etc.) is appended to the previous row.
  let lastRow: ParsedTransaction | null = null;
  let dateRowCount = 0;

  for (const r of rows) {
    const rowText = r.items.map((i) => i.str).join(' ');
    const dateRaw = valueInColumn(r, dateCol);
    const descText = valueInColumn(r, descCol);

    // Statement balance markers (top/bottom of the table) — skip outright.
    if (isBalanceLine(descText)) continue;

    if (!dateRaw) {
      if (descText && lastRow) {
        lastRow.rawLabel = mergeContinuationLabel(lastRow.rawLabel, descText);
      }
      continue;
    }
    dateRowCount++;
    const date = tryParseFrenchDate(dateRaw);
    if (!date) { skipped.push({ rowText, reason: `unparseable date "${dateRaw}"` }); continue; }

    let amount: string | null = null;
    if (signedCol) {
      const raw = valueInColumn(r, signedCol);
      amount = tryParseFrenchAmount(raw);
      if (!amount) { skipped.push({ rowText, reason: `unparseable amount "${raw}"` }); continue; }
    } else if (debitCol && creditCol) {
      const d = valueInColumn(r, debitCol);
      const c = valueInColumn(r, creditCol);
      if (d) {
        const n = tryParseFrenchAmount(d);
        if (!n) { skipped.push({ rowText, reason: `unparseable debit "${d}"` }); continue; }
        amount = n.startsWith('-') ? n : `-${n}`;
      } else if (c) {
        const n = tryParseFrenchAmount(c);
        if (!n) { skipped.push({ rowText, reason: `unparseable credit "${c}"` }); continue; }
        amount = n;
      } else {
        continue;       // neither populated → row is a separator/blank
      }
    } else {
      throw new Error('extractRows: invalid column set');
    }

    const newRow: ParsedTransaction = {
      date,
      amount,
      rawLabel: truncateLabel(descText),
      memo: null,
      fitid: null,
    };
    parsed.push(newRow);
    lastRow = newRow;
  }
  return { parsed, skipped, dateRowCount };
}

export function runHeuristic(pages: PdfPageText[]): HeuristicResult {
  if (pages.length === 0 || pages[0]!.items.length === 0) {
    return { zones: null, rows: [], confidence: 0, skippedRows: [] };
  }

  // Cluster rows + columns on page 1 to discover the template.
  const firstPageRows = clusterRows(pages[0]!.items);
  if (firstPageRows.length < 2) {
    return { zones: null, rows: [], confidence: 0, skippedRows: [] };
  }
  const columnsRaw = clusterColumns(firstPageRows);
  const columns = inferColumnRoles(columnsRaw);
  if (!columns) {
    return { zones: null, rows: [], confidence: 0, skippedRows: [] };
  }

  // Find the table top — first row with a parseable date in the date column.
  const dateColIdx = columnsRaw.findIndex(
    (_, i) => columns[i]?.role === 'date',
  );
  const rowsStartY = findRowsStartY(firstPageRows, dateColIdx);

  // Decide whether the table repeats per page: if pages > 1 and any later page
  // has rows whose date-column values parse, mark repeating.
  let tableRepeatsPerPage = false;
  if (pages.length > 1) {
    for (let p = 1; p < pages.length; p++) {
      const laterRows = clusterRows(pages[p]!.items);
      const dates = laterRows.map((r) => valueInColumn(r, columns[dateColIdx]!));
      if (dates.some((d) => DATE_RE.test(d))) { tableRepeatsPerPage = true; break; }
    }
  }

  // Extract rows from every page (page 1: from rowsStartY down; later pages: top-down).
  let allParsed: ParsedTransaction[] = [];
  let allSkipped: Array<{ rowText: string; reason: string }> = [];
  let totalConsidered = 0;
  for (let p = 0; p < pages.length; p++) {
    const pageRows = clusterRows(pages[p]!.items);
    const dataRows = p === 0 ? pageRows.filter((r) => r.yTop >= rowsStartY) : pageRows;
    if (!tableRepeatsPerPage && p > 0) continue;

    // Don't pre-filter by date — extractRows handles continuation rows (no date,
    // description only) by appending them to the previous transaction. It also
    // counts how many rows had a date so the confidence denominator stays
    // unaffected by continuations or footer/separator rows.
    void dateColIdx; // still referenced from the table-repeats check above
    const { parsed, skipped, dateRowCount } = extractRows(dataRows, columns);
    allParsed = allParsed.concat(parsed);
    allSkipped = allSkipped.concat(skipped);
    totalConsidered += dateRowCount;
  }

  const confidence = totalConsidered === 0 ? 0 : allParsed.length / totalConsidered;

  const tableZone: ZoneRect = {
    page: 0,
    x: Math.min(...columnsRaw.map((c) => c.xStart)),
    y: rowsStartY,
    w: Math.max(...columnsRaw.map((c) => c.xEnd)) - Math.min(...columnsRaw.map((c) => c.xStart)),
    h: pages[0]!.heightPt - rowsStartY,
  };
  const headerZone: ZoneRect = {
    page: 0, x: 0, y: 0, w: pages[0]!.widthPt, h: pages[0]!.heightPt * 0.15,
  };
  const zones: TemplateZones = {
    headerZone,
    tableZone,
    tableRepeatsPerPage,
    columns,
    rowsStartY,
  };

  return { zones, rows: allParsed, confidence, skippedRows: allSkipped };
}
