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
