import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { detectImageMime, transcodeHeicToJpeg } from '../index.js';

describe('detectImageMime', () => {
  it('recognizes JPEG', async () => {
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .jpeg().toBuffer();
    expect(detectImageMime(jpeg)).toBe('image/jpeg');
  });

  it('recognizes PNG', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .png().toBuffer();
    expect(detectImageMime(png)).toBe('image/png');
  });

  it('recognizes WebP', async () => {
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .webp().toBuffer();
    expect(detectImageMime(webp)).toBe('image/webp');
  });

  it('returns null for a PDF signature', () => {
    const pdf = Buffer.from('%PDF-1.4\n', 'utf8');
    expect(detectImageMime(pdf)).toBeNull();
  });
});

describe('transcodeHeicToJpeg', () => {
  it('is a no-op on JPEG (returns buffer unchanged mime)', async () => {
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .jpeg().toBuffer();
    const out = await transcodeHeicToJpeg(jpeg, 'image/jpeg');
    expect(out.length).toBeGreaterThan(0);
    // On non-HEIC input, the function returns the same bytes.
    expect(out).toBe(jpeg);
  });

  // HEIC decode requires libheif support compiled into the local sharp
  // binary; not guaranteed across environments. Gate with CAN_HEIC=1 when
  // it's known to be available.
  it.skipIf(!process.env.CAN_HEIC)('transcodes HEIC input to a JPEG buffer', async () => {
    const heic = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .toFormat('heif' as any).toBuffer();
    const out = await transcodeHeicToJpeg(heic, 'image/heic');
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
  });
});
