import { db } from '../../../db/client.js';
import { pdfImportDrafts } from '../../../db/schema.js';
import type { PdfTextItem, PdfPageText } from './text-extract.js';
import type { TemplateZones } from './zones.js';
import { renderPagesToPng, RENDER_SCALE, type RenderedPage } from './render.js';
import { flattenItems } from './diagnose.js';
import { runOcrJob } from './ocr-job.js';

export interface ParkedDraft {
  kind: 'needs_template';
  draftId: number;
  fingerprint: string;
  pages: RenderedPage[];
  textItems: PdfTextItem[];
  suggestedZones: TemplateZones | null;
  reason: 'no_text_layer' | 'low_confidence' | 'template_stale';
  staleDiagnostic?: string;
  sourceKind: 'pdf' | 'photo';
  ocrStatus: 'not_needed' | 'pending';
  ocrTotal: number;
}

// Park the current PDF as a draft for the interactive wizard. Renders the
// pages to PNG (needed for the zone canvas even on a text-layer PDF, since
// the canvas shows the raster) and — for the OCR path — kicks off a
// background job that streams words back into the draft's text_items.
export async function parkDraft(
  opts: { accountId: number; userId: number; buffer: Buffer },
  pages: PdfPageText[],
  fingerprint: string,
  suggestedZones: TemplateZones | null,
  reason: 'no_text_layer' | 'low_confidence' | 'template_stale',
  staleDiagnostic?: string,
): Promise<ParkedDraft> {
  const rendered = await renderPagesToPng(opts.buffer);
  const textItems = flattenItems(pages);
  const willOcr = reason === 'no_text_layer';
  const [draft] = await db.insert(pdfImportDrafts).values({
    userId: opts.userId,
    accountId: opts.accountId,
    pdfBytes: opts.buffer.toString('base64'),
    textItems,
    fingerprint,
    sourceKind: 'pdf',
    ocrStatus: willOcr ? 'pending' : 'not_needed',
    ocrTotal: willOcr ? rendered.length : 0,
    ocrProgress: 0,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).returning();
  if (willOcr && draft) {
    // queueMicrotask lets the HTTP response return immediately; the job
    // continues after the response is sent. Scanned PDFs render at
    // RENDER_SCALE (150 DPI) but the zone canvas operates in PDF points —
    // divide OCR word coords back to points.
    queueMicrotask(() => {
      void runOcrJob(draft.id, rendered.map((p) => p.pngBase64), RENDER_SCALE);
    });
  }
  return {
    kind: 'needs_template',
    draftId: draft!.id,
    fingerprint,
    pages: rendered,
    textItems,
    suggestedZones,
    reason,
    ...(staleDiagnostic ? { staleDiagnostic } : {}),
    sourceKind: 'pdf',
    ocrStatus: willOcr ? 'pending' : 'not_needed',
    ocrTotal: willOcr ? rendered.length : 0,
  };
}
