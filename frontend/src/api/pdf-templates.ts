export type ColumnRole =
  | 'date' | 'amountSigned' | 'debit' | 'credit' | 'description' | 'ignore';

export interface ZoneRect { page: number; x: number; y: number; w: number; h: number }

export interface TemplateZones {
  headerZone: ZoneRect;
  tableZone: ZoneRect;
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
  if (!r.ok && r.status !== 200) {
    const body = await r.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? 'upload failed'), { code: body.code, status: r.status });
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
    const body = await r.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? 'apply failed'), { code: body.code, status: r.status });
  }
  const { result, skippedRows } = await r.json();
  return { kind: 'imported', result, skippedRows };
}

export interface PdfTemplateRow {
  id: number; fingerprint: string; label: string;
  source: 'heuristic' | 'interactive'; createdAt: string; updatedAt: string;
}

export async function listPdfTemplates(): Promise<PdfTemplateRow[]> {
  const r = await fetch('/api/pdf-templates', { credentials: 'include' });
  if (!r.ok) throw new Error('failed to list templates');
  return (await r.json()).templates;
}

export async function renamePdfTemplate(id: number, label: string): Promise<void> {
  const r = await fetch(`/api/pdf-templates/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ label }),
  });
  if (!r.ok) throw new Error('rename failed');
}

export async function deletePdfTemplate(id: number): Promise<void> {
  const r = await fetch(`/api/pdf-templates/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!r.ok) throw new Error('delete failed');
}
