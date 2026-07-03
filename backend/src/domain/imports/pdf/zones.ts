export type ColumnRole =
  | 'date' | 'amountSigned' | 'debit' | 'credit' | 'description' | 'ignore';

export interface ZoneRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplateZones {
  headerZone: ZoneRect;
  tableZone: ZoneRect;
  // Content-based page filter. When set, applyTemplate scans every page of
  // the imported PDF and includes those containing this exact line (matched
  // with the same lineification as deriveAccountAnchor). Derived server-side
  // at template save time from `selectedPages` + the sample PDF's text, so
  // future statements with a different page count still filter the right
  // pages (e.g. "COMPTE COURANT n° 12345" pins the account by header text
  // rather than by absolute page index).
  pageAnchor?: string | null;
  // Page indices (0-based) that the import should process. Legacy — kept as
  // a fallback for templates saved before pageAnchor existed, and used as
  // the source signal when deriving pageAnchor.
  //   - undefined + tableRepeatsPerPage=true  → all pages
  //   - undefined + tableRepeatsPerPage=false → only page 0
  selectedPages?: number[];
  tableRepeatsPerPage: boolean;
  columns: Array<{ xStart: number; xEnd: number; role: ColumnRole }>;
  rowsStartY: number;
}

export function validateZones(z: TemplateZones): void {
  const dateCount = z.columns.filter((c) => c.role === 'date').length;
  const descCount = z.columns.filter((c) => c.role === 'description').length;
  const signedCount = z.columns.filter((c) => c.role === 'amountSigned').length;
  const debitCount = z.columns.filter((c) => c.role === 'debit').length;
  const creditCount = z.columns.filter((c) => c.role === 'credit').length;
  if (dateCount !== 1) throw new Error('zones: exactly one date column required');
  if (descCount !== 1) throw new Error('zones: exactly one description column required');
  const hasSigned = signedCount === 1 && debitCount === 0 && creditCount === 0;
  const hasPair = signedCount === 0 && debitCount === 1 && creditCount === 1;
  if (!hasSigned && !hasPair) {
    throw new Error('zones: need either one amountSigned column OR one debit + one credit');
  }
}
