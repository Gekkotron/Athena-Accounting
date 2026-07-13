import { db } from '../../../db/client.js';
import { pdfStatementTemplates, pdfImportDrafts } from '../../../db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { extractText, type PdfTextItem, type PdfPageText } from './text-extract.js';
import { fingerprintHeader } from './fingerprint.js';
import { runHeuristic } from './heuristic.js';
import { applyTemplate } from './template-apply.js';
import { deriveAccountAnchor, deriveOtherAccountAnchors, pageContainsAnchor } from './page-anchor.js';
import { renderPagesToPng, type RenderedPage } from './render.js';
import { validateZones, type TemplateZones } from './zones.js';
import { runImport, type ImportResult } from '../import-service.js';
import { parseStatementRows } from './parse-rows.js';
import { ocrPngPages } from '../ocr/index.js';

const HEURISTIC_AUTO_THRESHOLD = 0.9;
const HEURISTIC_SUGGEST_THRESHOLD = 0.5;

export type ImportPdfResult =
  | {
      kind: 'imported';
      result: ImportResult;
      skippedRows: Array<{ rowText: string; reason: string }>;
    }
  | {
      kind: 'needs_template';
      draftId: number;
      fingerprint: string;
      pages: RenderedPage[];
      textItems: PdfTextItem[];
      suggestedZones: TemplateZones | null;
      reason: 'no_text_layer' | 'low_confidence' | 'template_stale';
      // Human-readable explanation for why the saved template didn't apply
      // (only set when reason === 'template_stale'). The UI surfaces this
      // as a banner above the wizard so the user knows what to fix.
      staleDiagnostic?: string;
      sourceKind: 'pdf' | 'photo';
      ocrStatus: 'not_needed' | 'pending';
      ocrTotal: number;
    };

function flattenItems(pages: PdfPageText[]): PdfTextItem[] {
  return pages.flatMap((p) => p.items);
}

export async function importPdf(opts: {
  filename: string;
  accountId: number;
  userId: number;
  buffer: Buffer;
}): Promise<ImportPdfResult> {
  const pages = await extractText(opts.buffer);
  const noText = pages.every((p) => p.items.length === 0);
  const fingerprint = noText ? '' : fingerprintHeader(pages[0]!);

  // 1) Existing template for THIS (fingerprint, accountId)? Apply it.
  //    Multi-account PDFs: different accounts on the same statement have their
  //    own templates, so the same PDF re-uploaded with a different accountId
  //    correctly drops to the interactive flow instead of re-using the wrong
  //    page selection.
  if (fingerprint) {
    const [tpl] = await db
      .select()
      .from(pdfStatementTemplates)
      .where(
        and(
          eq(pdfStatementTemplates.fingerprint, fingerprint),
          eq(pdfStatementTemplates.accountId, opts.accountId),
        ),
      );
    if (tpl) {
      const z = tpl.zones as TemplateZones;
      const parsed = parseStatementRows(pages, z);
      if (parsed.kind === 'stale') {
        // The saved template doesn't produce anything on this PDF. Rather
        // than 422 the user out with a cryptic "retrain" message, drop
        // straight back into the wizard with a draft — same code path
        // that a first-time import takes — and include a short diagnostic
        // so the user knows WHY the template didn't apply.
        const diag = diagnoseStaleTemplate(pages, z, parsed.skippedRows);
        return await parkDraft(opts, pages, fingerprint, z, 'template_stale', diag);
      }
      const result = await runImport({
        filename: opts.filename,
        accountId: opts.accountId,
        userId: opts.userId,
        format: 'pdf',
        prepared: parsed.rows,
      });
      return { kind: 'imported', result, skippedRows: parsed.skippedRows };
    }
  }

  // 2) No template — try heuristic.
  if (noText) {
    return await parkDraft(opts, pages, fingerprint, null, 'no_text_layer');
  }
  const h = runHeuristic(pages);
  if (h.confidence >= HEURISTIC_AUTO_THRESHOLD && h.zones) {
    validateZones(h.zones);
    // Import FIRST. Only persist the heuristic template if rows actually landed —
    // otherwise a runImport failure would leave a stale template pointing at this
    // fingerprint and a retry would silently use it instead of re-running the
    // heuristic.
    const result = await runImport({
      filename: opts.filename,
      accountId: opts.accountId,
      userId: opts.userId,
      format: 'pdf',
      prepared: h.rows,
    });
    await db.insert(pdfStatementTemplates)
      .values({
        userId: opts.userId,
        fingerprint,
        accountId: opts.accountId,
        label: opts.filename,
        zones: h.zones,
        source: 'heuristic',
      })
      .onConflictDoNothing({
        target: [pdfStatementTemplates.fingerprint, pdfStatementTemplates.accountId],
      });
    return { kind: 'imported', result, skippedRows: h.skippedRows };
  }
  const suggested = h.confidence >= HEURISTIC_SUGGEST_THRESHOLD ? h.zones : null;
  return await parkDraft(opts, pages, fingerprint, suggested, 'low_confidence');
}

async function parkDraft(
  opts: { accountId: number; userId: number; buffer: Buffer },
  pages: PdfPageText[],
  fingerprint: string,
  suggestedZones: TemplateZones | null,
  reason: 'no_text_layer' | 'low_confidence' | 'template_stale',
  staleDiagnostic?: string,
): Promise<ImportPdfResult> {
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
    // Kick off the background OCR job. queueMicrotask lets the HTTP response
    // return immediately; the job continues after the response is sent.
    queueMicrotask(() => {
      void runOcrJob(draft.id, rendered.map((p) => p.pngBase64));
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

// Runs OCR on a draft's rendered pages, streaming progress into the draft
// row. Any thrown error transitions the draft to ocr_status = 'error' with
// a human-readable message; downstream polling picks that up.
export async function runOcrJob(draftId: number, pngBase64Pages: string[]): Promise<void> {
  try {
    const pages = await ocrPngPages(pngBase64Pages, {
      onPageDone: async (i) => {
        // Fire-and-forget: ocrPngPages doesn't await this callback, so any thrown
        // promise here would be an UnhandledRejection and crash the Node process.
        // A stuck progress counter is recoverable via the 24h draft sweeper.
        try {
          await db.update(pdfImportDrafts)
            .set({ ocrProgress: i + 1 })
            .where(eq(pdfImportDrafts.id, draftId));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[ocr] progress update failed', { draftId, page: i, err });
        }
      },
    });
    // Merge OCR words into text_items so parseStatementRows works unchanged.
    const items = pages.flatMap((p) => p.words);
    await db.update(pdfImportDrafts)
      .set({
        textItems: items,
        ocrStatus: 'ready',
        ocrProgress: pages.length,
      })
      .where(eq(pdfImportDrafts.id, draftId));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown OCR error';
    await db.update(pdfImportDrafts)
      .set({ ocrStatus: 'error', ocrError: message })
      .where(eq(pdfImportDrafts.id, draftId));
  }
}

// Explain in one short French sentence WHY the saved template produced 0
// rows on this PDF. Consulted only when we're about to fall back to the
// wizard; the string ends up in a banner above it.
function diagnoseStaleTemplate(
  pages: PdfPageText[],
  zones: TemplateZones,
  skippedRows: Array<{ rowText: string; reason: string }>,
): string {
  if (zones.pageAnchor && zones.pageAnchor.trim().length > 0) {
    const anchorFoundOn = pages.filter((p) => pageContainsAnchor(p, zones.pageAnchor!)).length;
    if (anchorFoundOn === 0) {
      return `L'ancre du compte « ${zones.pageAnchor} » n'a été trouvée sur aucune des ${pages.length} pages de ce PDF. La mise en page a peut-être changé — cochez la bonne ligne dans "Identifier votre compte" ci-dessous.`;
    }
  }
  const overrunWarning = skippedRows.find((s) => /non traitée/i.test(s.rowText));
  if (overrunWarning) {
    return 'Le template utilise des numéros de page absolus et le PDF est plus court que prévu. Recréez-le pour passer au filtrage par contenu.';
  }
  return 'Le template a été appliqué mais n\'a produit aucune ligne — le tableau, ses colonnes ou les marqueurs d\'autres comptes ne correspondent plus à ce PDF.';
}

export interface ApplyTemplateImportedResult {
  result: ImportResult;
  skippedRows: Array<{ rowText: string; reason: string }>;
}

export async function applyTemplateAndImport(opts: {
  draftId: number;
  label: string;
  zones: TemplateZones;
}): Promise<ApplyTemplateImportedResult> {
  validateZones(opts.zones);
  const [draft] = await db.select().from(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
  if (!draft) {
    const err = new Error('draft_expired');
    (err as any).code = 'draft_expired';
    throw err;
  }
  if (draft.expiresAt < new Date()) {
    await db.delete(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
    const err = new Error('draft_expired');
    (err as any).code = 'draft_expired';
    throw err;
  }
  // The column SHOULD be TEXT holding a base64 string (migration 0004 aligns
  // the runtime shape with the schema). Defensive Buffer handling stays as a
  // safety net so a regression surfaces with a clear message rather than a
  // mystery "Invalid PDF structure" from pdfjs.
  const stored = draft.pdfBytes as unknown;
  const b64 = typeof stored === 'string' ? stored : (stored as Buffer).toString('utf8');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 4 || buf.subarray(0, 4).toString('latin1') !== '%PDF') {
    const head = buf.subarray(0, 8).toString('hex');
    const err = new Error(
      `stored draft is not a valid PDF (got first bytes ${head}); ` +
      `re-upload the file or check migration 0004_pdf_bytes_to_text has been applied`,
    );
    throw err;
  }
  const pages = await extractText(buf);

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
    (err as any).code = 'template_yielded_no_rows';
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

export interface PreviewTemplateResult {
  rows: import('../ofx-parser.js').ParsedTransaction[];
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
    const err = new Error('draft_expired');
    (err as any).code = 'draft_expired';
    throw err;
  }
  const stored = draft.pdfBytes as unknown;
  const b64 = typeof stored === 'string' ? stored : (stored as Buffer).toString('utf8');
  const buf = Buffer.from(b64, 'base64');
  const pages = await extractText(buf);
  const { rows, skippedRows } = applyTemplate(pages, opts.zones);
  return { rows, skippedRows };
}
