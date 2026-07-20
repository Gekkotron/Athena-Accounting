import { eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { pdfImportDrafts } from '../../../db/schema.js';
import { applyTemplate } from './template-apply.js';
import { validateZones, type TemplateZones } from './zones.js';
import { hydrateDraftPages, draftExpiredError } from './hydrate.js';

export interface PreviewTemplateResult {
  // Optional confidence (0..1) per row, populated only when the row's cells
  // came from OCR text_items — see applyTemplate's rowConfidence.
  rows: Array<import('../ofx-parser.js').ParsedTransaction & { confidence?: number }>;
  skippedRows: Array<{ rowText: string; reason: string }>;
}

// Extract rows from a draft using proposed zones, without persisting
// anything. Powers the wizard's "Aperçu" button — mirrors
// applyTemplateAndImport's read path but stops before runImport, the
// template upsert, and the anchor derivation. Anchor derivation is
// deliberately skipped: preview should reflect what the user's CURRENT
// paint would extract, not what a save would stamp onto the template.
export async function previewTemplate(opts: {
  draftId: number;
  zones: TemplateZones;
  userId: number;
}): Promise<PreviewTemplateResult> {
  validateZones(opts.zones);
  const [draft] = await db.select().from(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
  if (!draft || draft.userId !== opts.userId || draft.expiresAt < new Date()) {
    throw draftExpiredError();
  }
  const stored = draft.pdfBytes as unknown;
  const b64 = typeof stored === 'string' ? stored : (stored as Buffer).toString('utf8');
  const pages = await hydrateDraftPages({
    pdfBytes: b64,
    textItems: draft.textItems,
    sourceKind: draft.sourceKind,
    ocrStatus: draft.ocrStatus,
  });
  const { rows, skippedRows } = applyTemplate(pages, opts.zones);
  return { rows, skippedRows };
}
