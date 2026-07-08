import { describe, it, expect } from 'vitest';
import {
  deriveContentKey, masterKey, wrapKey, unwrapKey,
  encryptEnvelope, decryptEnvelope,
} from '../../src/domain/mcp/crypto.js';

// Known-answer vector: token of 32 bytes each 0x01. Interop guarantee — the
// /mcp package tests the SAME vector, so both sides derive an identical key.
const TOKEN = Buffer.alloc(32, 0x01);
const EXPECTED_KEY_HEX =
  '657dd34f51509e47bd6708f0f21e7a21e83385d88a1d2d2056ea629580d235ba';

describe('mcp crypto', () => {
  it('deriveContentKey is deterministic and matches the shared vector', () => {
    const k = deriveContentKey(TOKEN);
    expect(k).toHaveLength(32);
    expect(k.toString('hex')).toBe(EXPECTED_KEY_HEX);
  });

  it('encrypt/decrypt round-trips with matching key + aad', () => {
    const k = deriveContentKey(TOKEN);
    const { nonce, ct } = encryptEnvelope(k, 'athena-mcp-v1|alice|req', '{"op":"x"}');
    expect(decryptEnvelope(k, 'athena-mcp-v1|alice|req', nonce, ct)).toBe('{"op":"x"}');
  });

  it('decrypt fails on wrong AAD (tamper detection)', () => {
    const k = deriveContentKey(TOKEN);
    const { nonce, ct } = encryptEnvelope(k, 'athena-mcp-v1|alice|req', 'hi');
    expect(() => decryptEnvelope(k, 'athena-mcp-v1|alice|res', nonce, ct)).toThrow();
  });

  it('wrap/unwrap round-trips; unwrap fails under a different master key', () => {
    const mk = masterKey('a'.repeat(32));
    const k = deriveContentKey(TOKEN);
    const wrapped = wrapKey(mk, k);
    expect(unwrapKey(mk, wrapped).equals(k)).toBe(true);
    expect(() => unwrapKey(masterKey('b'.repeat(32)), wrapped)).toThrow();
  });
});
