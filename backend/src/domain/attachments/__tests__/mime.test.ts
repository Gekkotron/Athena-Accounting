import { describe, it, expect } from 'vitest';
import { detectAttachmentMime } from '../mime.js';

describe('detectAttachmentMime', () => {
  it('detects JPEG from FF D8 FF magic bytes', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
    expect(detectAttachmentMime(buf)).toBe('image/jpeg');
  });

  it('detects PNG from its 8-byte signature', () => {
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16),
    ]);
    expect(detectAttachmentMime(buf)).toBe('image/png');
  });

  it('detects WebP from RIFF/WEBP envelope', () => {
    const buf = Buffer.from([
      // 'RIFF' size:0 'WEBP'
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(detectAttachmentMime(buf)).toBe('image/webp');
  });

  it('detects PDF from %PDF- signature', () => {
    const buf = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(8)]);
    expect(detectAttachmentMime(buf)).toBe('application/pdf');
  });

  it('detects HEIC from ftyp + heic brand', () => {
    const buf = Buffer.from([
      0x00, 0x00, 0x00, 0x20,
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x68, 0x65, 0x69, 0x63, // 'heic'
      0x00, 0x00, 0x00, 0x00,
    ]);
    expect(detectAttachmentMime(buf)).toBe('image/heic');
  });

  it('rejects buffers shorter than 12 bytes as unknown', () => {
    expect(detectAttachmentMime(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('rejects an unknown format (plain text)', () => {
    expect(detectAttachmentMime(Buffer.from('Hello, this is plain UTF-8 text.\n\n'))).toBeNull();
  });

  it('rejects ftyp with an unrelated brand (e.g. mp4)', () => {
    const buf = Buffer.from([
      0x00, 0x00, 0x00, 0x20,
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x6d, 0x70, 0x34, 0x32, // 'mp42' — NOT a HEIC brand
      0x00, 0x00, 0x00, 0x00,
    ]);
    expect(detectAttachmentMime(buf)).toBeNull();
  });
});
