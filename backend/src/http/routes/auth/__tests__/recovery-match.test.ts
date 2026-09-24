import { describe, it, expect, vi } from 'vitest';
import { hash } from '@node-rs/argon2';
import {
  ARGON2_OPTS,
  RECOVERY_CODE_COUNT,
  matchRecoveryCodeConstantTime,
} from '../recovery-match.js';

// Spy on argon2.verify so the constant-time invariant can be asserted by
// call count. The mock still forwards to the real implementation, so
// match/no-match semantics are the real argon2 semantics — only the
// spread across positions and absent rows is what we assert.
vi.mock('@node-rs/argon2', async () => {
  const actual = await vi.importActual<typeof import('@node-rs/argon2')>('@node-rs/argon2');
  return { ...actual, verify: vi.fn(actual.verify) };
});

async function hashCode(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTS);
}

describe('matchRecoveryCodeConstantTime', () => {
  it('empty unused[] → null, still fires RECOVERY_CODE_COUNT verify() calls', async () => {
    const { verify } = await import('@node-rs/argon2');
    vi.mocked(verify).mockClear();
    const result = await matchRecoveryCodeConstantTime([], 'anything');
    expect(result).toBeNull();
    expect(vi.mocked(verify)).toHaveBeenCalledTimes(RECOVERY_CODE_COUNT);
  });

  it('unused array shorter than RECOVERY_CODE_COUNT: real verifies for present rows, dummy for absent, no match', async () => {
    const { verify } = await import('@node-rs/argon2');
    const rows = [
      { id: 1, codeHash: await hashCode('code-alpha') },
      { id: 2, codeHash: await hashCode('code-beta') },
    ];
    vi.mocked(verify).mockClear();
    const result = await matchRecoveryCodeConstantTime(rows, 'not-any-of-them');
    expect(result).toBeNull();
    expect(vi.mocked(verify)).toHaveBeenCalledTimes(RECOVERY_CODE_COUNT);
  });

  it('match at position 0 → returns row 1, still fires RECOVERY_CODE_COUNT verifies', async () => {
    const { verify } = await import('@node-rs/argon2');
    const target = 'match-at-head';
    const rows = [
      { id: 1, codeHash: await hashCode(target) },
      { id: 2, codeHash: await hashCode('other-1') },
      { id: 3, codeHash: await hashCode('other-2') },
    ];
    vi.mocked(verify).mockClear();
    const result = await matchRecoveryCodeConstantTime(rows, target);
    expect(result).toEqual(rows[0]);
    expect(vi.mocked(verify)).toHaveBeenCalledTimes(RECOVERY_CODE_COUNT);
  });

  it('match at the last present row → returns it, still fires RECOVERY_CODE_COUNT verifies', async () => {
    const { verify } = await import('@node-rs/argon2');
    const target = 'match-at-tail';
    const rows = [
      { id: 10, codeHash: await hashCode('other-a') },
      { id: 20, codeHash: await hashCode('other-b') },
      { id: 30, codeHash: await hashCode(target) },
    ];
    vi.mocked(verify).mockClear();
    const result = await matchRecoveryCodeConstantTime(rows, target);
    expect(result).toEqual(rows[2]);
    expect(vi.mocked(verify)).toHaveBeenCalledTimes(RECOVERY_CODE_COUNT);
  });

  it('a full RECOVERY_CODE_COUNT unused set with one match → returns it, no dummy calls', async () => {
    const { verify } = await import('@node-rs/argon2');
    const target = 'the-one';
    const codes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', target];
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    const rows = await Promise.all(
      codes.map(async (c, i) => ({ id: i + 1, codeHash: await hashCode(c) })),
    );
    vi.mocked(verify).mockClear();
    const result = await matchRecoveryCodeConstantTime(rows, target);
    expect(result).toEqual(rows[RECOVERY_CODE_COUNT - 1]);
    expect(vi.mocked(verify)).toHaveBeenCalledTimes(RECOVERY_CODE_COUNT);
  });

  it('two rows share the same code (should never happen, defensive) → first match wins', async () => {
    const shared = 'duplicate-code';
    const dupHash = await hashCode(shared);
    const rows = [
      { id: 100, codeHash: dupHash },
      { id: 200, codeHash: dupHash },
    ];
    const result = await matchRecoveryCodeConstantTime(rows, shared);
    expect(result?.id).toBe(100);
  });

  it('a truncated / garbage hash yields no match and does not throw (verify.catch swallows the error)', async () => {
    const rows = [
      { id: 1, codeHash: 'not-a-real-argon2-hash' },
    ];
    const result = await matchRecoveryCodeConstantTime(rows, 'whatever');
    expect(result).toBeNull();
  });
});
