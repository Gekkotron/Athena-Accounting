import { db } from '../../../db/client.js';
import { pdfStatementTemplates, pdfImportDrafts } from '../../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { extractText, type PdfTextItem, type PdfPageText } from './text-extract.js';
import { fingerprintHeader } from './fingerprint.js';
import { runHeuristic } from './heuristic.js';
import { applyTemplate } from './template-apply.js';
import { renderPagesToPng, type RenderedPage } from './render.js';
import { validateZones, type TemplateZones } from './zones.js';
import { runImport, type ImportResult } from '../import-service.js';

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
      reason: 'no_text_layer' | 'low_confidence';
    };

function flattenItems(pages: PdfPageText[]): PdfTextItem[] {
  return pages.flatMap((p) => p.items);
}

export async function importPdf(opts: {
  filename: string;
  accountId: number;
  buffer: Buffer;
}): Promise<ImportPdfResult> {
  const pages = await extractText(opts.buffer);
  const noText = pages.every((p) => p.items.length === 0);
  const fingerprint = noText ? '' : fingerprintHeader(pages[0]!);

  // 1) Existing template? Apply it.
  if (fingerprint) {
    const [tpl] = await db
      .select()
      .from(pdfStatementTemplates)
      .where(eq(pdfStatementTemplates.fingerprint, fingerprint));
    if (tpl) {
      const { rows, skippedRows } = applyTemplate(pages, tpl.zones as TemplateZones);
      if (rows.length === 0) {
        const err = new Error('template_yielded_no_rows');
        (err as any).code = 'template_yielded_no_rows';
        throw err;
      }
      const result = await runImport({
        filename: opts.filename,
        accountId: opts.accountId,
        format: 'pdf',
        prepared: rows,
      });
      return { kind: 'imported', result, skippedRows };
    }
  }

  // 2) No template — try heuristic.
  if (noText) {
    return await parkDraft(opts, pages, fingerprint, null, 'no_text_layer');
  }
  const h = runHeuristic(pages);
  if (h.confidence >= HEURISTIC_AUTO_THRESHOLD && h.zones) {
    validateZones(h.zones);
    await db.insert(pdfStatementTemplates)
      .values({
        fingerprint,
        label: opts.filename,
        zones: h.zones,
        source: 'heuristic',
      })
      .onConflictDoNothing({ target: pdfStatementTemplates.fingerprint });
    const result = await runImport({
      filename: opts.filename,
      accountId: opts.accountId,
      format: 'pdf',
      prepared: h.rows,
    });
    return { kind: 'imported', result, skippedRows: h.skippedRows };
  }
  const suggested = h.confidence >= HEURISTIC_SUGGEST_THRESHOLD ? h.zones : null;
  return await parkDraft(opts, pages, fingerprint, suggested, 'low_confidence');
}

async function parkDraft(
  opts: { accountId: number; buffer: Buffer },
  pages: PdfPageText[],
  fingerprint: string,
  suggestedZones: TemplateZones | null,
  reason: 'no_text_layer' | 'low_confidence',
): Promise<ImportPdfResult> {
  const rendered = await renderPagesToPng(opts.buffer);
  const [draft] = await db.insert(pdfImportDrafts).values({
    accountId: opts.accountId,
    pdfBytes: opts.buffer.toString('base64'),
    textItems: flattenItems(pages),
    fingerprint,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).returning();
  return {
    kind: 'needs_template',
    draftId: draft!.id,
    fingerprint,
    pages: rendered,
    textItems: flattenItems(pages),
    suggestedZones,
    reason,
  };
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
  const buf = Buffer.from(draft.pdfBytes as string, 'base64');
  const pages = await extractText(buf);
  const { rows, skippedRows } = applyTemplate(pages, opts.zones);
  if (rows.length === 0) {
    const err = new Error('template_yielded_no_rows');
    (err as any).code = 'template_yielded_no_rows';
    throw err;
  }
  await db.insert(pdfStatementTemplates).values({
    fingerprint: draft.fingerprint,
    label: opts.label,
    zones: opts.zones,
    source: 'interactive',
  }).onConflictDoUpdate({
    target: pdfStatementTemplates.fingerprint,
    set: { label: opts.label, zones: opts.zones, source: 'interactive', updatedAt: sql`now()` },
  });
  const result = await runImport({
    filename: opts.label,
    accountId: draft.accountId,
    format: 'pdf',
    prepared: rows,
  });
  await db.delete(pdfImportDrafts).where(eq(pdfImportDrafts.id, opts.draftId));
  return { result, skippedRows };
}
