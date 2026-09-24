import { hash, verify, Algorithm } from '@node-rs/argon2';

// Same argon2 tuning as password hashing — kept in sync deliberately so a
// recovery-code verify has the same wall-clock as a password verify.
const ARGON2_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const RECOVERY_CODE_COUNT = 10;

// Constant-time recovery-code match: does exactly RECOVERY_CODE_COUNT
// argon2.verify() calls regardless of the user's actual unused-code count
// or the match position. Otherwise the wall-clock spread (100 ms per
// verify × N unused codes) is a coarse timing oracle for both "which
// position matched" and "how many codes remain unused". The dummy hash
// is pre-computed once at first use — argon2.verify's cost depends on
// the hash's embedded params, not on the plaintext, so a burn against
// this dummy has the same wall-clock as a real verify.
let dummyRecoveryHashPromise: Promise<string> | null = null;
function getDummyRecoveryHash(): Promise<string> {
  if (!dummyRecoveryHashPromise) {
    dummyRecoveryHashPromise = hash('athena-recovery-dummy-code', ARGON2_OPTS);
  }
  return dummyRecoveryHashPromise;
}

export async function matchRecoveryCodeConstantTime(
  unused: readonly { id: number; codeHash: string }[],
  normalized: string,
): Promise<{ id: number; codeHash: string } | null> {
  const dummy = await getDummyRecoveryHash();
  let matched: { id: number; codeHash: string } | null = null;
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const row = unused[i];
    if (row) {
      const ok = await verify(row.codeHash, normalized).catch(() => false);
      if (ok && matched === null) matched = row;
    } else {
      await verify(dummy, 'x').catch(() => false);
    }
  }
  return matched;
}

export { ARGON2_OPTS };
