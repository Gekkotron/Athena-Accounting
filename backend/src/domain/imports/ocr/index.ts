import { createWorker, type Worker } from 'tesseract.js';

export interface OcrWord {
  pageIndex: number; str: string;
  xLeft: number; yTop: number; width: number; height: number;
  confidence: number;
}
export interface OcrPage {
  pageIndex: number; widthPx: number; heightPx: number;
  words: OcrWord[]; meanConfidence: number;
}

export async function ocrPngPages(
  pngBase64Pages: string[],
  opts: {
    lang?: 'fra' | 'eng' | 'fra+eng';
    onPageDone?: (pageIndex: number, total: number) => void;
  } = {},
): Promise<OcrPage[]> {
  const lang = opts.lang ?? 'fra+eng';
  const worker: Worker = await createWorker(lang);
  try {
    const out: OcrPage[] = [];
    for (let i = 0; i < pngBase64Pages.length; i++) {
      const b64 = pngBase64Pages[i]!;
      const buf = Buffer.from(b64, 'base64');
      const { data } = await worker.recognize(buf);
      // tesseract.js v5 result: data.words = [{ text, bbox: { x0, y0, x1, y1 }, confidence }]
      const words: OcrWord[] = [];
      let confSum = 0;
      let confCount = 0;
      for (const w of data.words ?? []) {
        // Skip whitespace-only tokens tesseract sometimes emits.
        const text = (w.text ?? '').trim();
        if (!text) continue;
        const bbox = w.bbox;
        words.push({
          pageIndex: i,
          str: text,
          xLeft: bbox.x0,
          yTop: bbox.y0,
          width: bbox.x1 - bbox.x0,
          height: bbox.y1 - bbox.y0,
          confidence: (w.confidence ?? 0) / 100,
        });
        confSum += (w.confidence ?? 0) / 100;
        confCount += 1;
      }
      // Read page dims from data.imageWidth / imageHeight (populated in v5 output).
      const widthPx = (data as { imageWidth?: number }).imageWidth ?? 0;
      const heightPx = (data as { imageHeight?: number }).imageHeight ?? 0;
      out.push({
        pageIndex: i, widthPx, heightPx, words,
        meanConfidence: confCount === 0 ? 0 : confSum / confCount,
      });
      opts.onPageDone?.(i, pngBase64Pages.length);
    }
    return out;
  } finally {
    await worker.terminate();
  }
}
