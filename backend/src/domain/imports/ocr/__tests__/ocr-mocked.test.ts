import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  recognize: vi.fn(),
  terminate: vi.fn(async () => {}),
  createWorker: vi.fn(),
}));

vi.mock('tesseract.js', () => ({ createWorker: h.createWorker }));

import { ocrPngPages, readPngDims } from '../index.js';

function pngHeader(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.writeUInt32BE(0x49484452, 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
const b64 = (w: number, hh: number) => pngHeader(w, hh).toString('base64');

describe('readPngDims', () => {
  it('reads width and height from the IHDR chunk', () => {
    expect(readPngDims(pngHeader(640, 480))).toEqual({ widthPx: 640, heightPx: 480 });
  });

  it('rejects buffers shorter than a PNG header', () => {
    expect(() => readPngDims(Buffer.alloc(10))).toThrow('not a PNG');
  });

  it('rejects a wrong signature', () => {
    const b = pngHeader(1, 1);
    b.writeUInt32BE(0xffd8ffe0, 0);
    expect(() => readPngDims(b)).toThrow('not a PNG');
  });

  it('rejects a PNG whose first chunk is not IHDR', () => {
    const b = pngHeader(1, 1);
    b.writeUInt32BE(0x49454e44, 12);
    expect(() => readPngDims(b)).toThrow('missing IHDR');
  });
});

describe('ocrPngPages (tesseract stubbed)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  const savedLangPath = process.env.OCR_LANG_PATH;

  beforeEach(() => {
    h.recognize.mockReset();
    h.terminate.mockClear();
    h.createWorker.mockReset();
    h.createWorker.mockResolvedValue({ recognize: h.recognize, terminate: h.terminate });
    delete process.env.OCR_LANG_PATH;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    if (savedLangPath === undefined) delete process.env.OCR_LANG_PATH;
    else process.env.OCR_LANG_PATH = savedLangPath;
  });

  it('maps words to pixel boxes, normalizes confidence and averages it', async () => {
    h.recognize.mockResolvedValue({
      data: {
        words: [
          { text: 'CARREFOUR', bbox: { x0: 10, y0: 20, x1: 110, y1: 50 }, confidence: 90 },
          { text: '-34,20', bbox: { x0: 200, y0: 20, x1: 260, y1: 48 }, confidence: 70 },
        ],
      },
    });
    const [page] = await ocrPngPages([b64(400, 60)]);
    expect(page).toMatchObject({ pageIndex: 0, widthPx: 400, heightPx: 60 });
    expect(page!.words[0]).toEqual({
      pageIndex: 0, str: 'CARREFOUR', xLeft: 10, yTop: 20, width: 100, height: 30, confidence: 0.9,
    });
    expect(page!.words[1]!.width).toBe(60);
    expect(page!.meanConfidence).toBeCloseTo(0.8);
  });

  it('drops whitespace-only tokens and trims text, excluding them from the mean', async () => {
    h.recognize.mockResolvedValue({
      data: {
        words: [
          { text: '  ', bbox: { x0: 0, y0: 0, x1: 5, y1: 5 }, confidence: 10 },
          { text: ' abc ', bbox: { x0: 0, y0: 0, x1: 5, y1: 5 }, confidence: 50 },
        ],
      },
    });
    const [page] = await ocrPngPages([b64(10, 10)]);
    expect(page!.words.map((w) => w.str)).toEqual(['abc']);
    expect(page!.meanConfidence).toBeCloseTo(0.5);
  });

  it('returns meanConfidence 0 when no words are found or words are undefined', async () => {
    h.recognize.mockResolvedValueOnce({ data: { words: [] } }).mockResolvedValueOnce({ data: {} });
    const pages = await ocrPngPages([b64(10, 10), b64(10, 10)]);
    expect(pages.map((p) => p.meanConfidence)).toEqual([0, 0]);
    expect(pages.map((p) => p.words.length)).toEqual([0, 0]);
  });

  it('treats a missing confidence as 0', async () => {
    h.recognize.mockResolvedValue({
      data: { words: [{ text: 'x', bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }] },
    });
    const [page] = await ocrPngPages([b64(10, 10)]);
    expect(page!.words[0]!.confidence).toBe(0);
  });

  it('indexes pages in order and reports progress per page', async () => {
    h.recognize.mockResolvedValue({
      data: { words: [{ text: 'w', bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, confidence: 100 }] },
    });
    const seen: Array<[number, number]> = [];
    const pages = await ocrPngPages([b64(10, 10), b64(20, 20)], { onPageDone: (i, n) => seen.push([i, n]) });
    expect(pages.map((p) => p.pageIndex)).toEqual([0, 1]);
    expect(pages[1]!.words[0]!.pageIndex).toBe(1);
    expect(pages[1]!.widthPx).toBe(20);
    expect(seen).toEqual([[0, 2], [1, 2]]);
    expect(h.createWorker).toHaveBeenCalledTimes(1);
    expect(h.terminate).toHaveBeenCalledTimes(1);
  });

  it('defaults to fra+eng and honors an explicit lang', async () => {
    h.recognize.mockResolvedValue({ data: { words: [] } });
    await ocrPngPages([b64(1, 1)]);
    expect(h.createWorker.mock.calls[0]![0]).toBe('fra+eng');
    await ocrPngPages([b64(1, 1)], { lang: 'eng' });
    expect(h.createWorker.mock.calls[1]![0]).toBe('eng');
  });

  it('passes OCR_LANG_PATH as langPath when set, undefined otherwise', async () => {
    h.recognize.mockResolvedValue({ data: { words: [] } });
    await ocrPngPages([b64(1, 1)]);
    expect(h.createWorker.mock.calls[0]![2]).toBeUndefined();
    process.env.OCR_LANG_PATH = '/opt/langs';
    await ocrPngPages([b64(1, 1)]);
    expect(h.createWorker.mock.calls[1]![2]).toEqual({ langPath: '/opt/langs' });
  });

  it('terminates the worker and rethrows when a page is not a PNG', async () => {
    await expect(ocrPngPages([Buffer.from('nope').toString('base64')])).rejects.toThrow('not a PNG');
    expect(h.recognize).not.toHaveBeenCalled();
    expect(h.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates the worker when recognize rejects and stops further pages', async () => {
    h.recognize.mockRejectedValue(new Error('boom'));
    const onPageDone = vi.fn();
    await expect(ocrPngPages([b64(1, 1), b64(1, 1)], { onPageDone })).rejects.toThrow('boom');
    expect(h.recognize).toHaveBeenCalledTimes(1);
    expect(onPageDone).not.toHaveBeenCalled();
    expect(h.terminate).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list for no pages but still cleans up the worker', async () => {
    expect(await ocrPngPages([])).toEqual([]);
    expect(h.terminate).toHaveBeenCalledTimes(1);
  });
});
