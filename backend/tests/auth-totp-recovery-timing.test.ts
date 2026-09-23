// Security-audit regression guard: the recovery-code verify used to
// iterate unused codes and argon2.verify each until a match, then break.
// The wall-clock spread (100 ms × match position × remaining unused
// codes) was a coarse timing oracle for both "which code matched" and
// "how many codes are still unused". matchRecoveryCodeConstantTime now
// does exactly RECOVERY_CODE_COUNT verify() calls regardless. This test
// pins the invariant by spying on the argon2 module. Requires
// RUN_DB_TESTS=1.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Partial-mock so tests can inspect verify call counts without changing
// behaviour. Every consumer imports verify from this module, so the spy
// sees ALL argon2.verify calls in the process.
vi.mock('@node-rs/argon2', async () => {
  const actual = await vi.importActual<typeof import('@node-rs/argon2')>('@node-rs/argon2');
  return { ...actual, verify: vi.fn(actual.verify) };
});

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

const RECOVERY_CODE_COUNT = 10;

d('POST /api/auth/2fa/verify — recovery-code constant-time match', () => {
  beforeEach(() => {
    vi.mocked(vi.fn()).mockReset();
  });

  it('argon2.verify fires exactly RECOVERY_CODE_COUNT times whether the match is at position 0, at position N-1, or absent', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { verify } = await import('@node-rs/argon2');
    const app = await buildApp();

    // Fresh onboarding + enrol via /confirm to get 10 real recovery codes.
    const username = `recovery-timing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const password = 'recovery-timing-pw-1234';
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username, password },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username, password },
    });
    const outerCookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
    await app.inject({
      method: 'POST', url: '/api/auth/2fa/enroll',
      headers: { cookie: outerCookie }, payload: { password },
    });
    const codeRes = await app.inject({
      method: 'GET', url: '/api/auth/2fa/__debug/current-code',
      headers: { cookie: outerCookie },
    });
    const confirm = await app.inject({
      method: 'POST', url: '/api/auth/2fa/confirm',
      headers: { cookie: outerCookie }, payload: { code: codeRes.json().code },
    });
    const codes: string[] = confirm.json().recoveryCodes;
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);

    async function halfCookieAfterLogin(): Promise<string> {
      const l = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username, password },
      });
      return l.cookies[0]!.name + '=' + l.cookies[0]!.value;
    }

    async function verifyCountForRecovery(recoveryCode: string): Promise<number> {
      vi.mocked(verify).mockClear();
      const half = await halfCookieAfterLogin();
      // Login's verify(password) fires once BEFORE the recovery path,
      // so subtract that to get the recovery-only count.
      const preLoginBaseline = vi.mocked(verify).mock.calls.length;
      await app.inject({
        method: 'POST', url: '/api/auth/2fa/verify',
        headers: { cookie: half }, payload: { code: recoveryCode },
      });
      const total = vi.mocked(verify).mock.calls.length;
      return total - preLoginBaseline;
    }

    const firstMatchCount = await verifyCountForRecovery(codes[0]!);
    const lastMatchCount = await verifyCountForRecovery(codes[RECOVERY_CODE_COUNT - 1]!);
    const noMatchCount = await verifyCountForRecovery('AAAA-BBBB');

    expect(firstMatchCount).toBe(RECOVERY_CODE_COUNT);
    expect(lastMatchCount).toBe(RECOVERY_CODE_COUNT);
    expect(noMatchCount).toBe(RECOVERY_CODE_COUNT);

    await app.close();
  });
});
