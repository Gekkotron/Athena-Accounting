import { db } from '../../../db/client.js';
import { pdfStatementTemplates } from '../../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { extractText, type PdfTextItem } from './text-extract.js';
import { fingerprintHeader } from './fingerprint.js';
import { runHeuristic } from './heuristic.js';
import { validateZones, type TemplateZones } from './zones.js';
import { runImport, type ImportResult } from '../import-service.js';
import { parseStatementRows } from './parse-rows.js';
import type { RenderedPage } from './render.js';
import { parkDraft, type ParkedDraft } from './park-draft.js';
import { diagnoseStaleTemplate } from './diagnose.js';

// Public API re-exports so external callers (routes/imports.ts,
// domain/imports/photo/index.ts) can keep importing from `pdf/index.js`.
export { runOcrJob } from './ocr-job.js';
export { applyTemplateAndImport, type ApplyTemplateImportedResult } from './apply-and-import.js';
export { previewTemplate, type PreviewTemplateResult } from './preview.js';

const HEURISTIC_AUTO_THRESHOLD = 0.9;
const HEURISTIC_SUGGEST_THRESHOLD = 0.5;

export type ImportPdfResult =
  | {
      kind: 'imported';
      result: ImportResult;
      skippedRows: Array<{ rowText: string; reason: string }>;
    }
  | ParkedDraft;

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

// Ensure `RenderedPage` and `PdfTextItem` remain re-exportable for callers
// that pulled them from the old flat module.
export type { RenderedPage, PdfTextItem };
