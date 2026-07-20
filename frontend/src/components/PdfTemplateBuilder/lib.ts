import type { PageRect } from './ZoneCanvas.js';
import type { TemplateZones } from '../../api/pdf-templates.js';
import type { AmountMode } from './constants';

export type Canvas = 'date' | 'description' | 'signed' | 'debit' | 'credit';

export interface AmountColumns {
  amountMode: AmountMode;
  signedCol: PageRect | null;
  debitCol: PageRect | null;
  creditCol: PageRect | null;
}

export interface ZonesInput extends AmountColumns {
  headerRect: PageRect;
  tableRect: PageRect | null;
  tableRepeats: boolean;
  selectedPages: number[];
  pickedAnchor: string | null;
  pickedOtherAnchors: string[];
  dateCol: PageRect | null;
  descCol: PageRect | null;
}

export interface ColumnLabels {
  table: string;
  date: string;
  description: string;
  amount: string;
  debit: string;
  credit: string;
}

export interface ReferenceRect {
  rect: PageRect;
  label?: string;
  color?: string;
}

const COLOR_TABLE = '#5b6478';
const COLOR_NEUTRAL = '#7dd3c0';
const COLOR_AMOUNT = '#e69782';

// Assemble the wire-shaped `TemplateZones` payload from the wizard's
// piecewise-painted rectangles. Returns `null` when any mandatory piece is
// missing so the caller can gate submit/preview on truthiness. The output
// order for `columns` (date, description, amount(s)) matches the backend's
// expected role ordering and must not change without coordinating a schema
// migration.
export function buildZones(s: ZonesInput): TemplateZones | null {
  if (!s.tableRect || !s.dateCol || !s.descCol) return null;

  const cols: TemplateZones['columns'] = [
    { xStart: s.dateCol.x, xEnd: s.dateCol.x + s.dateCol.w, role: 'date' },
    { xStart: s.descCol.x, xEnd: s.descCol.x + s.descCol.w, role: 'description' },
  ];

  if (s.amountMode === 'signed') {
    if (!s.signedCol) return null;
    cols.push({
      xStart: s.signedCol.x,
      xEnd: s.signedCol.x + s.signedCol.w,
      role: 'amountSigned',
    });
  } else {
    if (!s.debitCol || !s.creditCol) return null;
    cols.push({ xStart: s.debitCol.x, xEnd: s.debitCol.x + s.debitCol.w, role: 'debit' });
    cols.push({ xStart: s.creditCol.x, xEnd: s.creditCol.x + s.creditCol.w, role: 'credit' });
  }

  return {
    headerZone: { page: 0, ...s.headerRect },
    tableZone: { page: 0, ...s.tableRect },
    tableRepeatsPerPage: s.tableRepeats,
    selectedPages: [...s.selectedPages].sort((a, b) => a - b),
    ...(s.pickedAnchor ? { pageAnchor: s.pickedAnchor } : {}),
    ...(s.pickedOtherAnchors.length > 0
      ? { otherAnchors: [...s.pickedOtherAnchors].sort() }
      : {}),
    columns: cols,
    rowsStartY: s.tableRect.y,
  };
}

export interface RectsInput {
  tableRect: PageRect | null;
  dateCol: PageRect | null;
  descCol: PageRect | null;
  amountMode: AmountMode;
  signedCol: PageRect | null;
  debitCol: PageRect | null;
  creditCol: PageRect | null;
}

// Dashed "already drawn" overlay rectangles for the ZoneCanvas of the given
// step. Every drawn rect is shown except the one the user is currently
// painting — otherwise the dashed overlay would fight the live paint.
export function buildReferenceRects(
  s: RectsInput,
  labels: ColumnLabels,
  current: Canvas,
): ReferenceRect[] {
  const refs: ReferenceRect[] = [];
  if (s.tableRect) refs.push({ rect: s.tableRect, label: labels.table, color: COLOR_TABLE });
  if (current !== 'date' && s.dateCol) {
    refs.push({ rect: s.dateCol, label: labels.date, color: COLOR_NEUTRAL });
  }
  if (current !== 'description' && s.descCol) {
    refs.push({ rect: s.descCol, label: labels.description, color: COLOR_NEUTRAL });
  }
  if (s.amountMode === 'signed') {
    if (current !== 'signed' && s.signedCol) {
      refs.push({ rect: s.signedCol, label: labels.amount, color: COLOR_AMOUNT });
    }
  } else {
    if (current !== 'debit' && s.debitCol) {
      refs.push({ rect: s.debitCol, label: labels.debit, color: COLOR_AMOUNT });
    }
    if (current !== 'credit' && s.creditCol) {
      refs.push({ rect: s.creditCol, label: labels.credit, color: COLOR_NEUTRAL });
    }
  }
  return refs;
}

export function isAmountReady(s: AmountColumns): boolean {
  return s.amountMode === 'signed'
    ? s.signedCol !== null
    : s.debitCol !== null && s.creditCol !== null;
}

export interface SubmitReadinessInput extends AmountColumns {
  tableRect: PageRect | null;
  dateCol: PageRect | null;
  descCol: PageRect | null;
}

export function isReadyToSubmit(s: SubmitReadinessInput, label: string): boolean {
  return (
    !!s.tableRect &&
    !!s.dateCol &&
    !!s.descCol &&
    isAmountReady(s) &&
    label.trim().length > 0
  );
}
