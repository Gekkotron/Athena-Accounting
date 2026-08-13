import { describe, it, expect } from 'vitest';
import { computeAttachmentFingerprint } from '../src/domain/backup/attachments-fingerprint.js';

describe('computeAttachmentFingerprint', () => {
  it('is stable for the same inputs', () => {
    const at = new Date('2026-08-13T09:00:00Z');
    expect(computeAttachmentFingerprint({ count: 3, maxCreatedAt: at })).toBe(
      computeAttachmentFingerprint({ count: 3, maxCreatedAt: at }),
    );
  });

  it('shifts when count changes', () => {
    const at = new Date('2026-08-13T09:00:00Z');
    expect(computeAttachmentFingerprint({ count: 3, maxCreatedAt: at })).not.toBe(
      computeAttachmentFingerprint({ count: 4, maxCreatedAt: at }),
    );
  });

  it('shifts when maxCreatedAt changes', () => {
    const a = computeAttachmentFingerprint({
      count: 3,
      maxCreatedAt: new Date('2026-08-13T09:00:00Z'),
    });
    const b = computeAttachmentFingerprint({
      count: 3,
      maxCreatedAt: new Date('2026-08-13T09:00:01Z'),
    });
    expect(a).not.toBe(b);
  });

  it('handles the empty-library case (count 0, no timestamp)', () => {
    const fp = computeAttachmentFingerprint({ count: 0, maxCreatedAt: null });
    // 64 hex characters = SHA-256 output length.
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    // Also stable — first-run guard relies on this returning the same value
    // across ticks when nothing has been uploaded yet.
    expect(computeAttachmentFingerprint({ count: 0, maxCreatedAt: null })).toBe(fp);
  });
});
