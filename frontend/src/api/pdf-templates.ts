export type ColumnRole =
  | 'date' | 'amountSigned' | 'debit' | 'credit' | 'description' | 'ignore';

export interface ZoneRect { page: number; x: number; y: number; w: number; h: number }

export interface TemplateZones {
  headerZone: ZoneRect;
  tableZone: ZoneRect;
  selectedPages?: number[];
  // Optional manual overrides for the account/other-account markers.
  // When absent, the backend derives them from selectedPages + text.
  pageAnchor?: string;
  otherAnchors?: string[];
  tableRepeatsPerPage: boolean;
  columns: Array<{ xStart: number; xEnd: number; role: ColumnRole }>;
  rowsStartY: number;
}

export interface PdfImportImported {
  kind: 'imported';
  result: {
    fileImportId: number;
    insertedCount: number;
    dedupSkipped: number;
    totalLines: number;
    // Rows the parser produced but the DB deduplicated. Shown in the
    // import summary so the user can see WHAT was skipped, not just the
    // count. Optional for backward compatibility with a pre-fix backend.
    dedupSkippedRows?: Array<{ date: string; amount: string; rawLabel: string }>;
  };
  skippedRows: Array<{ rowText: string; reason: string }>;
}

export interface PreviewParsedRow {
  date: string;
  amount: string;
  rawLabel: string;
  memo: string | null;
  fitid: string | null;
}

export interface PreviewResult {
  rows: PreviewParsedRow[];
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
  reason: 'no_text_layer' | 'low_confidence' | 'template_stale';
  // Human-readable explanation set only when reason === 'template_stale'.
  staleDiagnostic?: string;
  sourceKind: 'pdf' | 'photo';
  ocrStatus: 'not_needed' | 'pending';
  ocrTotal: number;
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

export async function submitZones(
  draftId: number,
  label: string,
  zones: TemplateZones,
  overrideRows?: Array<{ date: string; label: string; amount: string }>,
): Promise<PdfImportImported> {
  const r = await fetch('/api/imports/pdf/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ draftId, label, zones,
      ...(overrideRows ? { override_rows: overrideRows } : {}),
    }),
  });
  if (!r.ok) {
    return failure(r, 'apply failed');
  }
  const { result, skippedRows } = await r.json();
  return { kind: 'imported', result, skippedRows };
}

export async function submitPhoto(file: File, accountId: number): Promise<PdfImportResponse> {
  const form = new FormData();
  form.append('file', file);
  const r = await fetch(`/api/imports/photo?accountId=${accountId}`, {
    method: 'POST', body: form, credentials: 'include',
  });
  if (!r.ok) {
    return failure(r, 'upload failed');
  }
  return await r.json();
}

export type OcrStatusResponse = {
  status: 'not_needed' | 'pending' | 'ready' | 'error';
  progress: number;
  total: number;
  meanConfidence?: number;
  error?: string;
};

export async function getOcrStatus(draftId: number): Promise<OcrStatusResponse> {
  const r = await fetch(`/api/imports/pdf/drafts/${draftId}/ocr-status`, { credentials: 'include' });
  if (!r.ok) throw new Error(`ocr-status ${r.status}`);
  return await r.json();
}

export interface DraftResponse {
  textItems: PdfTextItem[];
  ocrStatus: OcrStatusResponse['status'];
}

export async function getDraft(draftId: number): Promise<DraftResponse> {
  const r = await fetch(`/api/imports/pdf/drafts/${draftId}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`draft ${r.status}`);
  return await r.json();
}

export async function previewZones(draftId: number, zones: TemplateZones): Promise<PreviewResult> {
  const r = await fetch('/api/imports/pdf/templates/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ draftId, zones }),
  });
  if (!r.ok) return failure(r, 'preview failed');
  return await r.json();
}

export interface PdfTemplateRow {
  id: number;
  fingerprint: string;
  accountId: number | null;
  label: string;
  source: 'heuristic' | 'interactive';
  // True when the template stores a content-based page anchor (new
  // multi-account filter). False = legacy absolute-index filter, which may
  // silently drop pages when a future statement grows.
  hasPageAnchor: boolean;
  // The stored anchor + other-account markers, surfaced for diagnostics
  // ("does the template match the right pages?"). Empty when unavailable.
  pageAnchor: string | null;
  otherAnchors: string[];
  createdAt: string;
  updatedAt: string;
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
