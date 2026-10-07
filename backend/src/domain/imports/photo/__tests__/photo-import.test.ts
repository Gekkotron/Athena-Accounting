import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

const h = vi.hoisted(() => ({
  inserted: undefined as unknown,
  returned: [] as unknown[],
  runOcrJob: vi.fn(),
}));

vi.mock('../../../../db/client.js', () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        h.inserted = v;
        return { returning: async () => h.returned };
      },
    }),
  },
}));
vi.mock('../../pdf/index.js', () => ({ runOcrJob: h.runOcrJob }));

import {
  detectImageMime,
  importPhoto,
  PhotoTooLargeError,
  PhotoUnsupportedMimeError,
  transcodeHeicToJpeg,
} from '../index.js';

function ftyp(brand: string): Buffer {
  const b = Buffer.alloc(16);
  b.write('ftyp', 4, 'ascii');
  b.write(brand, 8, 'ascii');
  return b;
}

describe('detectImageMime (synthetic headers)', () => {
  it('returns null for buffers under 12 bytes', () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it('detects JPEG from the FF D8 FF prefix', () => {
    const b = Buffer.alloc(12);
    b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff;
    expect(detectImageMime(b)).toBe('image/jpeg');
  });

  it('detects PNG from the signature', () => {
    const b = Buffer.alloc(12);
    b.writeUInt32BE(0x89504e47, 0);
    expect(detectImageMime(b)).toBe('image/png');
  });

  it('requires WEBP at bytes 8-11 after RIFF', () => {
    const riff = Buffer.alloc(12);
    riff.write('RIFF', 0, 'ascii');
    riff.write('WAVE', 8, 'ascii');
    expect(detectImageMime(riff)).toBeNull();
    riff.write('WEBP', 8, 'ascii');
    expect(detectImageMime(riff)).toBe('image/webp');
  });

  it.each(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'])('detects HEIC brand %s', (brand) => {
    expect(detectImageMime(ftyp(brand))).toBe('image/heic');
  });

  it('rejects an ftyp container with a non-HEIC brand', () => {
    expect(detectImageMime(ftyp('mp42'))).toBeNull();
  });
});

describe('transcodeHeicToJpeg', () => {
  it.each(['image/png', 'image/webp', 'image/jpeg'])('returns the same buffer for %s', async (mime) => {
    const buf = Buffer.from('anything');
    expect(await transcodeHeicToJpeg(buf, mime)).toBe(buf);
  });
});

describe('error classes', () => {
  it('PhotoUnsupportedMimeError has a default French message', () => {
    expect(new PhotoUnsupportedMimeError().message).toBe("format d'image non supporté");
    expect(new PhotoUnsupportedMimeError('x').message).toBe('x');
  });

  it('PhotoTooLargeError reports the size', () => {
    expect(new PhotoTooLargeError(123).message).toContain('(got 123)');
  });
});

describe('importPhoto', () => {
  beforeEach(() => {
    h.inserted = undefined;
    h.returned = [{ id: 42 }];
    h.runOcrJob.mockReset();
  });

  async function jpeg(w = 8, hh = 6) {
    return sharp({ create: { width: w, height: hh, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  }

  it('rejects oversize buffers before any decoding or DB write', async () => {
    const big = Buffer.alloc(25 * 1024 * 1024 + 1);
    await expect(importPhoto({ filename: 'a.jpg', accountId: 1, userId: 1, buffer: big }))
      .rejects.toBeInstanceOf(PhotoTooLargeError);
    expect(h.inserted).toBeUndefined();
  });

  it('rejects unrecognized content with PhotoUnsupportedMimeError', async () => {
    await expect(importPhoto({
      filename: 'a.pdf', accountId: 1, userId: 1, buffer: Buffer.from('%PDF-1.4 not an image'),
    })).rejects.toBeInstanceOf(PhotoUnsupportedMimeError);
    expect(h.inserted).toBeUndefined();
  });

  it('inserts a pending photo draft and returns a needs_template result with pixel dims', async () => {
    const result = await importPhoto({ filename: 'a.jpg', accountId: 7, userId: 3, buffer: await jpeg(8, 6) });
    const row = h.inserted as Record<string, unknown>;
    expect(row).toMatchObject({
      userId: 3, accountId: 7, textItems: [], fingerprint: '',
      sourceKind: 'photo', ocrStatus: 'pending', ocrTotal: 1, ocrProgress: 0,
    });
    const png = Buffer.from(row.pdfBytes as string, 'base64');
    expect(detectImageMime(png)).toBe('image/png');
    expect(result).toMatchObject({
      kind: 'needs_template', draftId: 42, reason: 'no_text_layer',
      sourceKind: 'photo', ocrStatus: 'pending', ocrTotal: 1, suggestedZones: null,
    });
    const page = (result as { pages: Array<Record<string, unknown>> }).pages[0]!;
    expect(page).toMatchObject({ pageIndex: 0, widthPt: 8, heightPt: 6, pngBase64: row.pdfBytes });
  });

  it('starts the OCR job with the stored PNG', async () => {
    await importPhoto({ filename: 'a.jpg', accountId: 1, userId: 1, buffer: await jpeg() });
    expect(h.runOcrJob).toHaveBeenCalledTimes(1);
    const [id, pages, total] = h.runOcrJob.mock.calls[0]!;
    expect(id).toBe(42);
    expect(pages).toEqual([(h.inserted as { pdfBytes: string }).pdfBytes]);
    expect(total).toBe(1);
  });

  it('throws and does not start OCR when the insert returns no row', async () => {
    h.returned = [];
    await expect(importPhoto({ filename: 'a.jpg', accountId: 1, userId: 1, buffer: await jpeg() }))
      .rejects.toThrow('draft insert failed');
    await Promise.resolve();
    expect(h.runOcrJob).not.toHaveBeenCalled();
  });

  it('accepts PNG and WebP inputs', async () => {
    for (const fmt of ['png', 'webp'] as const) {
      const buf = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })[fmt]().toBuffer();
      const r = await importPhoto({ filename: `a.${fmt}`, accountId: 1, userId: 1, buffer: buf });
      expect(r.kind).toBe('needs_template');
    }
  });
});
