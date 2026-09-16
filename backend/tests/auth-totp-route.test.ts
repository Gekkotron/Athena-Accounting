// requires Postgres/pglite — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// AUTH_MODE=none skips these — the whole surface is guarded by an
// early return in totpRoutes() (no local placeholder-hash user has a
// meaningful password to gate enrolment).
const RUN = !!process.env.RUN_DB_TESTS && process.env.AUTH_MODE !== 'none';

let app: FastifyInstance;
let cookie: string;
let uid: number;

async function extractCookie(res: { cookies: Array<{ name: string; value: string }> }): Promise<string> {
  const c = res.cookies[0]!;
  return `${c.name}=${c.value}`;
}

async function loginFresh(): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { username: 'totp-user', password: 'totp-user-1234' },
  });
  return extractCookie(res);
}

async function enrolAndConfirm(sessionCookie: string): Promise<{ secret: string; codes: string[] }> {
  const enroll = await app.inject({
    method: 'POST', url: '/api/auth/2fa/enroll',
    headers: { cookie: sessionCookie },
    payload: { password: 'totp-user-1234' },
  });
  expect(enroll.statusCode).toBe(200);
  const { secret } = enroll.json();
  const codeRes = await app.inject({
    method: 'GET', url: '/api/auth/2fa/__debug/current-code',
    headers: { cookie: sessionCookie },
  });
  const { code } = codeRes.json();
  const confirm = await app.inject({
    method: 'POST', url: '/api/auth/2fa/confirm',
    headers: { cookie: sessionCookie },
    payload: { code },
  });
  expect(confirm.statusCode).toBe(200);
  return { secret, codes: confirm.json().recoveryCodes };
}

async function clearTotp(): Promise<void> {
  const { db } = await import('../src/db/client.js');
  const { userTotp, userTotpRecoveryCodes } = await import('../src/db/schema.js');
  const { eq } = await import('drizzle-orm');
  await db.delete(userTotpRecoveryCodes).where(eq(userTotpRecoveryCodes.userId, uid));
  await db.delete(userTotp).where(eq(userTotp.userId, uid));
}

describe.skipIf(!RUN)('/api/auth/2fa', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; // enables the __debug/current-code helper
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'totp-user', password: 'totp-user-1234' },
    });
    cookie = await loginFresh();

    const { db } = await import('../src/db/client.js');
    const { users } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const [u] = await db.select().from(users).where(eq(users.username, 'totp-user'));
    uid = u!.id;
  });

  afterEach(async () => {
    await clearTotp();
    // Refresh the session cookie: some tests regenerate() the session
    // on /verify success and invalidate the outer-scope cookie.
    cookie = await loginFresh();
  });

  // ------------------------------------------------------------------
  // status
  // ------------------------------------------------------------------
  describe('GET /status', () => {
    it('returns { enabled: false, remainingRecoveryCodes: 0 } before enrol', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/auth/2fa/status', headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: false, remainingRecoveryCodes: 0 });
    });

    it('returns { enabled: true, remainingRecoveryCodes: 10 } after confirm', async () => {
      await enrolAndConfirm(cookie);
      const res = await app.inject({
        method: 'GET', url: '/api/auth/2fa/status', headers: { cookie },
      });
      expect(res.json()).toEqual({ enabled: true, remainingRecoveryCodes: 10 });
    });

    it('401 without a session', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/2fa/status' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ------------------------------------------------------------------
  // enroll
  // ------------------------------------------------------------------
  describe('POST /enroll', () => {
    it('returns a fresh base32 secret + otpauth URL', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/enroll',
        headers: { cookie }, payload: { password: 'totp-user-1234' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Athena%3Atotp-user\?/);
      expect(body.otpauthUrl).toContain(`secret=${body.secret}`);
    });

    it('rejects a wrong password with 401', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/enroll',
        headers: { cookie }, payload: { password: 'wrong-pass' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a malformed body with 400', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/enroll',
        headers: { cookie }, payload: { password: '' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('second enrol overwrites the pending secret', async () => {
      const a = await app.inject({
        method: 'POST', url: '/api/auth/2fa/enroll',
        headers: { cookie }, payload: { password: 'totp-user-1234' },
      });
      const b = await app.inject({
        method: 'POST', url: '/api/auth/2fa/enroll',
        headers: { cookie }, payload: { password: 'totp-user-1234' },
      });
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(a.json().secret).not.toBe(b.json().secret);
    });

    it('409 when already activated', async () => {
      await enrolAndConfirm(cookie);
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/enroll',
        headers: { cookie }, payload: { password: 'totp-user-1234' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('401 without a session', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/enroll',
        payload: { password: 'totp-user-1234' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ------------------------------------------------------------------
  // confirm
  // ------------------------------------------------------------------
  describe('POST /confirm', () => {
    it('400 without a pending enrolment', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/confirm',
        headers: { cookie }, payload: { code: '123456' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('401 on wrong code', async () => {
      await app.inject({
        method: 'POST', url: '/api/auth/2fa/enroll',
        headers: { cookie }, payload: { password: 'totp-user-1234' },
      });
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/confirm',
        headers: { cookie }, payload: { code: '000000' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('400 on malformed code (non-numeric or wrong length)', async () => {
      await app.inject({
        method: 'POST', url: '/api/auth/2fa/enroll',
        headers: { cookie }, payload: { password: 'totp-user-1234' },
      });
      const a = await app.inject({
        method: 'POST', url: '/api/auth/2fa/confirm',
        headers: { cookie }, payload: { code: 'abcdef' },
      });
      const b = await app.inject({
        method: 'POST', url: '/api/auth/2fa/confirm',
        headers: { cookie }, payload: { code: '12345' },
      });
      expect(a.statusCode).toBe(400);
      expect(b.statusCode).toBe(400);
    });

    it('activates and returns 10 recovery codes', async () => {
      const { codes } = await enrolAndConfirm(cookie);
      expect(codes).toHaveLength(10);
      codes.forEach((c: string) => expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/));
      const uniques = new Set(codes);
      expect(uniques.size).toBe(10);
    });

    it("409 if the row is already activated", async () => {
      await enrolAndConfirm(cookie);
      const codeRes = await app.inject({
        method: 'GET', url: '/api/auth/2fa/__debug/current-code', headers: { cookie },
      });
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/confirm',
        headers: { cookie }, payload: { code: codeRes.json().code },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  // ------------------------------------------------------------------
  // login → verify
  // ------------------------------------------------------------------
  describe('two-step login', () => {
    it('login with TOTP active returns { requiresTotp: true } and stamps totpPending', async () => {
      await enrolAndConfirm(cookie);
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'totp-user', password: 'totp-user-1234' },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json()).toEqual({ requiresTotp: true });
      const halfCookie = await extractCookie(login);

      // Any non-allowlisted route should 401 with 'totp required'
      const gated = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie: halfCookie },
      });
      expect(gated.statusCode).toBe(401);
      expect(gated.json().error).toBe('totp required');
    });

    it('verify with correct TOTP clears totpPending and returns user', async () => {
      await enrolAndConfirm(cookie);
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'totp-user', password: 'totp-user-1234' },
      });
      const halfCookie = await extractCookie(login);
      // Grab the current code via the outer (fully-authed) cookie — the
      // debug endpoint requires a full session.
      const codeRes = await app.inject({
        method: 'GET', url: '/api/auth/2fa/__debug/current-code', headers: { cookie },
      });
      const verify = await app.inject({
        method: 'POST', url: '/api/auth/2fa/verify',
        headers: { cookie: halfCookie }, payload: { code: codeRes.json().code },
      });
      expect(verify.statusCode).toBe(200);
      expect(verify.json().user.username).toBe('totp-user');

      // Session id was regenerated — the new cookie fully authenticates.
      const fullCookie = await extractCookie(verify);
      const me = await app.inject({
        method: 'GET', url: '/api/auth/me', headers: { cookie: fullCookie },
      });
      expect(me.statusCode).toBe(200);
    });

    it('verify with wrong TOTP returns 401', async () => {
      await enrolAndConfirm(cookie);
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'totp-user', password: 'totp-user-1234' },
      });
      const halfCookie = await extractCookie(login);
      const verify = await app.inject({
        method: 'POST', url: '/api/auth/2fa/verify',
        headers: { cookie: halfCookie }, payload: { code: '000000' },
      });
      expect(verify.statusCode).toBe(401);
    });

    it('verify with a recovery code once burns it', async () => {
      const { codes } = await enrolAndConfirm(cookie);
      const [firstCode] = codes;
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'totp-user', password: 'totp-user-1234' },
      });
      const halfCookie = await extractCookie(login);
      const verify = await app.inject({
        method: 'POST', url: '/api/auth/2fa/verify',
        headers: { cookie: halfCookie }, payload: { code: firstCode },
      });
      expect(verify.statusCode).toBe(200);

      // Status shows one less remaining
      const fullCookie = await extractCookie(verify);
      const status = await app.inject({
        method: 'GET', url: '/api/auth/2fa/status', headers: { cookie: fullCookie },
      });
      expect(status.json().remainingRecoveryCodes).toBe(9);

      // Re-using the same recovery code fails
      const login2 = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'totp-user', password: 'totp-user-1234' },
      });
      const halfCookie2 = await extractCookie(login2);
      const verify2 = await app.inject({
        method: 'POST', url: '/api/auth/2fa/verify',
        headers: { cookie: halfCookie2 }, payload: { code: firstCode },
      });
      expect(verify2.statusCode).toBe(401);
    });

    it('recovery code accepts dash-stripped and lowercase input', async () => {
      const { codes } = await enrolAndConfirm(cookie);
      const [firstCode] = codes;
      const stripped = firstCode.replace('-', '').toLowerCase();
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'totp-user', password: 'totp-user-1234' },
      });
      const halfCookie = await extractCookie(login);
      const verify = await app.inject({
        method: 'POST', url: '/api/auth/2fa/verify',
        headers: { cookie: halfCookie }, payload: { code: stripped },
      });
      expect(verify.statusCode).toBe(200);
    });

    it('verify returns 400 when totp is not enabled', async () => {
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'totp-user', password: 'totp-user-1234' },
      });
      // No TOTP → response is { user }, not requiresTotp
      expect(login.json().user.username).toBe('totp-user');
      const c = await extractCookie(login);
      // But calling /verify anyway on a fully-authed session (no
      // totpPending) should return "totp not enabled".
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/verify',
        headers: { cookie: c }, payload: { code: '123456' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('login without TOTP returns the original { user } shape unchanged', async () => {
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'totp-user', password: 'totp-user-1234' },
      });
      expect(login.statusCode).toBe(200);
      const body = login.json();
      expect(body).toEqual({ user: { id: uid, username: 'totp-user' } });
    });
  });

  // ------------------------------------------------------------------
  // disable
  // ------------------------------------------------------------------
  describe('POST /disable', () => {
    it('requires both password and code', async () => {
      const { codes } = await enrolAndConfirm(cookie);
      const wrongPw = await app.inject({
        method: 'POST', url: '/api/auth/2fa/disable',
        headers: { cookie }, payload: { password: 'wrong', code: codes[0] },
      });
      expect(wrongPw.statusCode).toBe(401);

      const wrongCode = await app.inject({
        method: 'POST', url: '/api/auth/2fa/disable',
        headers: { cookie },
        payload: { password: 'totp-user-1234', code: '000000' },
      });
      expect(wrongCode.statusCode).toBe(401);
    });

    it('removes the row on success (both password + recovery code accepted)', async () => {
      const { codes } = await enrolAndConfirm(cookie);
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/disable',
        headers: { cookie },
        payload: { password: 'totp-user-1234', code: codes[1] },
      });
      expect(res.statusCode).toBe(200);
      const status = await app.inject({
        method: 'GET', url: '/api/auth/2fa/status', headers: { cookie },
      });
      expect(status.json()).toEqual({ enabled: false, remainingRecoveryCodes: 0 });
    });

    it('400 when TOTP is not enabled', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/disable',
        headers: { cookie },
        payload: { password: 'totp-user-1234', code: '123456' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ------------------------------------------------------------------
  // regenerate-codes
  // ------------------------------------------------------------------
  describe('POST /regenerate-codes', () => {
    it('replaces the code set with 10 fresh codes', async () => {
      const { codes: original } = await enrolAndConfirm(cookie);
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/regenerate-codes',
        headers: { cookie }, payload: { password: 'totp-user-1234' },
      });
      expect(res.statusCode).toBe(200);
      const fresh: string[] = res.json().recoveryCodes;
      expect(fresh).toHaveLength(10);
      // No overlap with the original set
      const overlap = fresh.filter((c) => original.includes(c));
      expect(overlap).toEqual([]);
      // A previously valid code no longer verifies.
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'totp-user', password: 'totp-user-1234' },
      });
      const halfCookie = await extractCookie(login);
      const verify = await app.inject({
        method: 'POST', url: '/api/auth/2fa/verify',
        headers: { cookie: halfCookie }, payload: { code: original[0] },
      });
      expect(verify.statusCode).toBe(401);
    });

    it('requires the current password', async () => {
      await enrolAndConfirm(cookie);
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/regenerate-codes',
        headers: { cookie }, payload: { password: 'wrong' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('400 when TOTP is not enabled', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/2fa/regenerate-codes',
        headers: { cookie }, payload: { password: 'totp-user-1234' },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
