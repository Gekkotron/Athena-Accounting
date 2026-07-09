import { applyTemplate } from './template-apply.js';
import type { PdfPageText } from './text-extract.js';
import type { TemplateZones } from './zones.js';
import type { ParsedTransaction } from '../ofx-parser.js';

export type ParseRowsResult =
  | { kind: 'parsed'; rows: ParsedTransaction[]; skippedRows: Array<{ rowText: string; reason: string }> }
  | { kind: 'stale'; skippedRows: Array<{ rowText: string; reason: string }> };

// Apply a saved template to already-extracted pages, WITHOUT inserting.
// Zero rows means the template no longer matches this PDF (caller decides
// whether to re-train the wizard or report needs_template).
export function parseStatementRows(pages: PdfPageText[], zones: TemplateZones): ParseRowsResult {
  const { rows, skippedRows } = applyTemplate(pages, zones);
  if (rows.length === 0) return { kind: 'stale', skippedRows };
  return { kind: 'parsed', rows, skippedRows };
}
