import { describe, it, expect } from 'vitest';
import { deriveContentKey, encryptEnvelope, decryptEnvelope } from '../src/crypto.js';

// SAME vector as backend/tests/mcp/crypto.test.ts — proves both packages
// derive an identical content key from the same token.
const TOKEN = Buffer.alloc(32, 0x01);
const EXPECTED_KEY_HEX = '657dd34f51509e47bd6708f0f21e7a21e83385d88a1d2d2056ea629580d235ba';

describe('mcp package crypto', () => {
  it('derives the shared key vector', () => {
    expect(deriveContentKey(TOKEN).toString('hex')).toBe(EXPECTED_KEY_HEX);
  });
  it('round-trips its own envelope', () => {
    const k = deriveContentKey(TOKEN);
    const { nonce, ct } = encryptEnvelope(k, 'athena-mcp-v1|u|req', 'hello');
    expect(decryptEnvelope(k, 'athena-mcp-v1|u|req', nonce, ct)).toBe('hello');
  });
});
