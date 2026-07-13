import sharp from 'sharp';
import { db } from '../../../db/client.js';
import { pdfImportDrafts } from '../../../db/schema.js';
import { runOcrJob } from '../pdf/index.js';
import type { ImportPdfResult } from '../pdf/index.js';

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export function detectImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  // WebP: RIFF ???? WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp';
  // HEIC: bytes 4-7 = 'ftyp', bytes 8-11 in {'heic','heix','hevc','mif1',...}
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.slice(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  return null;
}

export async function transcodeHeicToJpeg(buf: Buffer, mime: string): Promise<Buffer> {
  if (mime !== 'image/heic') return buf;
  return await sharp(buf).jpeg().toBuffer();
}

export class PhotoTooLargeError extends Error {
  constructor(size: number) { super(`photo exceeds ${MAX_PHOTO_BYTES} bytes (got ${size})`); }
}
export class PhotoUnsupportedMimeError extends Error {
  constructor() { super('unsupported image format'); }
}

export async function importPhoto(opts: {
  filename: string;
  accountId: number;
  userId: number;
  buffer: Buffer;
}): Promise<ImportPdfResult> {
  if (opts.buffer.length > MAX_PHOTO_BYTES) throw new PhotoTooLargeError(opts.buffer.length);
  const mime = detectImageMime(opts.buffer);
  if (!mime) throw new PhotoUnsupportedMimeError();

  const jpegBuf = await transcodeHeicToJpeg(opts.buffer, mime);
  // Normalize to PNG so downstream page-rendering assumptions hold.
  const pngBuf = await sharp(jpegBuf).png().toBuffer();
  const meta = await sharp(pngBuf).metadata();
  const pngBase64 = pngBuf.toString('base64');

  const [draft] = await db.insert(pdfImportDrafts).values({
    userId: opts.userId,
    accountId: opts.accountId,
    pdfBytes: pngBase64,
    textItems: [],
    fingerprint: '',
    sourceKind: 'photo',
    ocrStatus: 'pending',
    ocrTotal: 1,
    ocrProgress: 0,
  }).returning();
  if (!draft) throw new Error('draft insert failed');

  queueMicrotask(() => {
    void runOcrJob(draft.id, [pngBase64]);
  });

  return {
    kind: 'needs_template',
    draftId: draft.id,
    fingerprint: '',
    pages: [{ pageIndex: 0, pngBase64, widthPt: meta.width ?? 0, heightPt: meta.height ?? 0 }],
    textItems: [],
    suggestedZones: null,
    reason: 'no_text_layer',
    sourceKind: 'photo',
    ocrStatus: 'pending',
    ocrTotal: 1,
  };
}
