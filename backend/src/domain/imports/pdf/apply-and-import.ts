import { eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { pdfImportDrafts, pdfStatementTemplates } from '../../../db/schema.js';
import { applyTemplate } from './template-apply.js';
import { deriveAccountAnchor, deriveOtherAccountAnchors } from './page-anchor.js';
import { validateZones, type TemplateZones } from './zones.js';
import { runImport, type ImportResult } from '../import-service.js';
import { hydrateDraftPages, draftExpiredError } from './hydrate.js';

export interface ApplyTemplateImportedResult {
  result: ImportResult;
  skippedRows: Array<{ rowText: string; reason: string }>;
}

export async function applyTemplateAndImport(opts: {
  draftId: number;
  label: string;
  zones: TemplateZones;
  overrideRows?: Array<{ date: string; label: string; amount: string }>;
  userId: number;
}): Promise<ApplyTemplateImportedResult> {
  validateZones(opts.zones);
  const [draft] = await db.select().from(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
  if (!draft || draft.userId !== opts.userId) throw draftExpiredError();
  if (draft.expiresAt < new Date()) {
    await db.delete(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
    throw draftExpiredError();
  }

  // The user hand-fixed OCR misreads in the preview panel — skip zone
  // parsing entirely and hand the reviewed rows straight to runImport.
  // The template row from the earlier zone-painting step is left as-is;
  // this call only imports transactions, it doesn't retrain the template.
  if (opts.overrideRows && opts.overrideRows.length > 0) {
    const prepared = opts.overrideRows.map((r) => ({
      date: r.date,
      amount: r.amount.replace(',', '.'),
      rawLabel: r.label,
      memo: null,
      fitid: null,
    }));
    const result = await runImport({
      filename: opts.label,
      accountId: draft.accountId,
      userId: draft.userId!,
      format: 'pdf',
      prepared,
    });
    await db.delete(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
    return { result, skippedRows: [] };
  }

  // The column SHOULD be TEXT holding a base64 string (migration 0004 aligns
  // the runtime shape with the schema). Defensive Buffer handling stays as a
  // safety net so a regression surfaces with a clear message rather than a
  // mystery "Invalid PDF structure" from pdfjs.
  const stored = draft.pdfBytes as unknown;
  const b64 = typeof stored === 'string' ? stored : (stored as Buffer).toString('utf8');
  const buf = Buffer.from(b64, 'base64');
  // The %PDF magic-byte guard is meaningful only when we're about to run
  // pdfjs on the buffer — skip it for photo drafts (PNG bytes are legit).
  if (draft.sourceKind !== 'photo') {
    if (buf.length < 4 || buf.subarray(0, 4).toString('latin1') !== '%PDF') {
      const head = buf.subarray(0, 8).toString('hex');
      throw new Error(
        `stored draft is not a valid PDF (got first bytes ${head}); ` +
        `re-upload the file or check migration 0004_pdf_bytes_to_text has been applied`,
      );
    }
  }
  const pages = await hydrateDraftPages({
    pdfBytes: b64,
    textItems: draft.textItems,
    sourceKind: draft.sourceKind,
    ocrStatus: draft.ocrStatus,
  });

  // Stamp a content-based anchor onto the template so subsequent statements
  // with a different page count still pick the right pages. Falls back to
  // legacy `selectedPages` when the sample can't yield a unique marker
  // (e.g. all pages selected, or no line unique to the selected set).
  if (
    (!opts.zones.pageAnchor || opts.zones.pageAnchor.trim().length === 0) &&
    opts.zones.selectedPages &&
    opts.zones.selectedPages.length > 0
  ) {
    const anchor = deriveAccountAnchor(pages, opts.zones.selectedPages);
    if (anchor) opts.zones.pageAnchor = anchor;
  }

  // Also collect markers for OTHER accounts present on the sample. When a
  // page carrying our anchor holds one of these lines below the anchor,
  // applyTemplate cuts off row processing at that Y — fixes the mid-page
  // account boundary (e.g. Compte Courant ends, Livret A starts, on the
  // same physical page).
  if (
    (!opts.zones.otherAnchors || opts.zones.otherAnchors.length === 0) &&
    opts.zones.selectedPages &&
    opts.zones.selectedPages.length > 0
  ) {
    const others = deriveOtherAccountAnchors(
      pages,
      opts.zones.selectedPages,
      opts.zones.pageAnchor ?? null,
      opts.zones.rowsStartY,
    );
    if (others.length > 0) opts.zones.otherAnchors = others;
  }

  const { rows, skippedRows } = applyTemplate(pages, opts.zones);
  if (rows.length === 0) {
    const err = new Error('template_yielded_no_rows');
    (err as { code?: string }).code = 'template_yielded_no_rows';
    throw err;
  }
  // Import FIRST. If runImport throws, the template upsert and draft delete
  // never happen — the draft stays alive (so the user can retry), and the
  // template isn't created/overwritten on a failed run.
  const result = await runImport({
    filename: opts.label,
    accountId: draft.accountId,
    userId: draft.userId!,
    format: 'pdf',
    prepared: rows,
  });
  await db.insert(pdfStatementTemplates).values({
    userId: draft.userId,
    fingerprint: draft.fingerprint,
    accountId: draft.accountId,
    label: opts.label,
    zones: opts.zones,
    source: 'interactive',
  }).onConflictDoUpdate({
    target: [pdfStatementTemplates.fingerprint, pdfStatementTemplates.accountId],
    set: { label: opts.label, zones: opts.zones, source: 'interactive', updatedAt: sql`now()` },
  });
  await db.delete(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
  return { result, skippedRows };
}
