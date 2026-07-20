import { eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { pdfImportDrafts } from '../../../db/schema.js';
import { ocrPngPages } from '../ocr/index.js';

// Runs OCR on a draft's rendered pages, streaming progress into the draft
// row. Any thrown error transitions the draft to ocr_status = 'error' with
// a human-readable message; downstream polling picks that up.
//
// `coordScale` divides the pixel-space (xLeft/yTop/width/height) coordinates
// Tesseract emits so stored text_items land in the same coordinate system as
// the wizard's zone canvas. Callers:
//   - scanned PDFs (parkDraft) pass RENDER_SCALE (=150/72) — canvas widthPt
//     is in PDF points but the PNGs OCR sees are at 150 DPI.
//   - photos (importPhoto) pass 1 — the canvas widthPt is already the pixel
//     width sharp reported, so pixels-in matches pixels-out.
export async function runOcrJob(
  draftId: number,
  pngBase64Pages: string[],
  coordScale = 1,
): Promise<void> {
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
    // Rescale coords into the zone canvas's coordinate system.
    const items = pages.flatMap((p) => p.words.map((w) => ({
      ...w,
      xLeft: w.xLeft / coordScale,
      yTop: w.yTop / coordScale,
      width: w.width / coordScale,
      height: w.height / coordScale,
    })));
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
