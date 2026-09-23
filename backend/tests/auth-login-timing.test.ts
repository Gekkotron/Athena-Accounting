// Security-audit regression guard for POST /api/auth/login: the
// user_totp lookup used to run ONLY after a successful password verify,
// so a wrong-password 401 diverged in wall-clock from a correct-password
// requiresTotp response by ~1 indexed query — leaking whether an account
// had 2FA enrolled without needing the correct password. Post-refactor
// the SELECT runs in Promise.all with the password verify, so both
// branches issue exactly the same DB call count. Requires RUN_DB_TESTS=1.
import { describe, it, expect } from 'vitest';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

d('POST /api/auth/login — TOTP-enrolment timing leak', () => {
  it('issues the user_totp SELECT on wrong-password AND correct-password for the same TOTP-enrolled user', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { db } = await import('../src/db/client.js');
    const { users, userTotp } = await import('../src/db/schema.js');
    const { totpKey, encryptTotpSecret } = await import('../src/domain/auth/totp-crypto.js');
    const { env } = await import('../src/env.js');
    const { eq } = await import('drizzle-orm');

    const app = await buildApp();
    // Fresh onboarding + enrol TOTP directly at the DB level (no route
    // round-trip so this test doesn't depend on totp routes).
    const username = `login-timing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const password = 'timing-test-password-1234';
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username, password },
    });
    const [user] = await db.select().from(users).where(eq(users.username, username));
    const uid = user!.id;
    await db.insert(userTotp).values({
      userId: uid,
      secretCiphertext: encryptTotpSecret(totpKey(env.SESSION_SECRET), uid, 'JBSWY3DPEHPK3PXP'),
      enabledAt: new Date(),
    });

    // Count db.select() invocations across login. Every login for an
    // existing user should now do 2 selects (users + userTotp) regardless
    // of password-verify outcome. Pre-refactor: wrong-pw = 1, correct-pw = 2.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origSelect = (db as any).select.bind(db);
    let count = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).select = (...args: unknown[]) => { count++; return origSelect(...args); };

    try {
      count = 0;
      const wrong = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username, password: 'wrong-password' },
      });
      expect(wrong.statusCode).toBe(401);
      const wrongCount = count;

      count = 0;
      const right = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username, password },
      });
      expect(right.statusCode).toBe(200);
      expect(right.json()).toEqual({ requiresTotp: true });
      const rightCount = count;

      // Same call count regardless of password outcome.
      expect(wrongCount).toBe(rightCount);
      // Sanity: at least 2 (users + userTotp).
      expect(wrongCount).toBeGreaterThanOrEqual(2);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).select = origSelect;
    }
    await app.close();
  });

  it('non-existent user still short-circuits (no SELECT parity needed there)', async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: `nonexistent-${Date.now()}`, password: 'anything' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
