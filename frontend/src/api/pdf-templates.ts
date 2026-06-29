export type ColumnRole =
  | 'date' | 'amountSigned' | 'debit' | 'credit' | 'description' | 'ignore';

export interface ZoneRect { page: number; x: number; y: number; w: number; h: number }

export interface TemplateZones {
  headerZone: ZoneRect;
  tableZone: ZoneRect;
  selectedPages?: number[];
  tableRepeatsPerPage: boolean;
  columns: Array<{ xStart: number; xEnd: number; role: ColumnRole }>;
  rowsStartY: number;
}

export interface PdfImportImported {
  kind: 'imported';
  result: { fileImportId: number; insertedCount: number; dedupSkipped: number; totalLines: number };
  skippedRows: Array<{ rowText: string; reason: string }>;
}

export interface PdfTextItem {
  pageIndex: number; str: string;
  xLeft: number; yTop: number; width: number; height: number;
}

export interface PdfImportNeedsTemplate {
  kind: 'needs_template';
  draftId: number;
  fingerprint: string;
  pages: Array<{ pageIndex: number; pngBase64: string; widthPt: number; heightPt: number }>;
  textItems: PdfTextItem[];
  suggestedZones: TemplateZones | null;
  reason: 'no_text_layer' | 'low_confidence';
}

export type PdfImportResponse = PdfImportImported | PdfImportNeedsTemplate;

export async function submitPdf(file: File, accountId: number): Promise<PdfImportResponse> {
  const form = new FormData();
  form.append('file', file);
  const r = await fetch(`/api/imports?accountId=${accountId}`, {
    method: 'POST', body: form, credentials: 'include',
  });
  if (!r.ok) {
    return failure(r, 'upload failed');
  }
  return await r.json();
}

export async function submitZones(draftId: number, label: string, zones: TemplateZones): Promise<PdfImportImported> {
  const r = await fetch('/api/imports/pdf/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ draftId, label, zones }),
  });
  if (!r.ok) {
    return failure(r, 'apply failed');
  }
  const { result, skippedRows } = await r.json();
  return { kind: 'imported', result, skippedRows };
}

export interface PdfTemplateRow {
  id: number; fingerprint: string; label: string;
  source: 'heuristic' | 'interactive'; createdAt: string; updatedAt: string;
}

async function failure(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  // The backend sends { error, message?, code? }. Surface both so the UI can
  // show the underlying cause instead of just the generic "apply failed".
  const head = body.error ?? fallback;
  const text = body.message ? `${head}: ${body.message}` : head;
  throw Object.assign(new Error(text), {
    code: body.code,
    status: r.status,
    detail: body.message ?? null,
  });
}

export async function listPdfTemplates(): Promise<PdfTemplateRow[]> {
  const r = await fetch('/api/pdf-templates', { credentials: 'include' });
  if (!r.ok) return failure(r, 'failed to list templates');
  return (await r.json()).templates;
}

export async function renamePdfTemplate(id: number, label: string): Promise<void> {
  const r = await fetch(`/api/pdf-templates/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ label }),
  });
  if (!r.ok) return failure(r, 'rename failed');
}

export async function deletePdfTemplate(id: number): Promise<void> {
  const r = await fetch(`/api/pdf-templates/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!r.ok) return failure(r, 'delete failed');
}
