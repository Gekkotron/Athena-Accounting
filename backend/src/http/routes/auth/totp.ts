import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { users, userTotp, userTotpRecoveryCodes } from '../../../db/schema.js';
import { env } from '../../../env.js';
import {
  generateCode,
  generateRecoveryCode,
  generateSecretBase32,
  normalizeRecoveryCode,
  otpauthUrl,
  verifyCode,
} from '../../../domain/auth/totp.js';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  totpKey,
} from '../../../domain/auth/totp-crypto.js';
import {
  ARGON2_OPTS,
  RECOVERY_CODE_COUNT,
  matchRecoveryCodeConstantTime,
} from './recovery-match.js';
// The 10/min bucket is the security guard on brute-force verify /
// wrong-password enroll; in tests the many calls exhaust it and the
// suite goes red for the wrong reason. `AUTH_RATE_LIMIT_MAX` bumps
// the ceiling for the fullstack Playwright harness (production mode
// but many verify calls across specs). @fastify/rate-limit has its
// own upstream coverage.
const TOTP_RATE_OVERRIDE = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 0);
const RATE = {
  max: TOTP_RATE_OVERRIDE > 0
    ? TOTP_RATE_OVERRIDE
    : process.env.NODE_ENV === 'test'
      ? 10000
      : 10,
  timeWindow: '1 minute' as const,
};

export async function totpRoutes(app: FastifyInstance): Promise<void> {
  // Guard: this whole surface exists only in session mode. In `none`
  // mode there is no meaningful account password and the desktop lock
  // pattern is unrelated — TOTP-on-desktop-lock is a separate design.
  if (env.AUTH_MODE !== 'session') return;

  const key = totpKey(env.SESSION_SECRET);

  // -- Status ---------------------------------------------------------
  // Enrolment state for the current user, plus the count of unused
  // recovery codes for the Settings card ("Activé, N codes de
  // récupération restants"). Not rate-limited: a plain GET the UI polls
  // on the Security page mount.
  app.get('/api/auth/2fa/status', { preHandler: app.requireAuth }, async (req) => {
    const uid = req.session.userId!;
    const [row] = await db
      .select({ enabledAt: userTotp.enabledAt })
      .from(userTotp)
      .where(eq(userTotp.userId, uid))
      .limit(1);
    const enabled = !!row?.enabledAt;
    let remainingRecoveryCodes = 0;
    if (enabled) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(userTotpRecoveryCodes)
        .where(and(eq(userTotpRecoveryCodes.userId, uid), isNull(userTotpRecoveryCodes.usedAt)));
      remainingRecoveryCodes = row?.n ?? 0;
    }
    return { enabled, remainingRecoveryCodes };
  });

  // -- Enroll ---------------------------------------------------------
  // Password gate defends against a leaked-session self-lockout: an
  // attacker who owns the session cookie must not be able to silently
  // enrol a factor they control and lock the real user out of their
  // own account.
  const EnrollBody = z.object({ password: z.string().min(1) });
  app.post('/api/auth/2fa/enroll', {
    preHandler: app.requireAuth,
    config: { rateLimit: RATE },
  }, async (req, reply) => {
    const parsed = EnrollBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const uid = req.session.userId!;
    const [user] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    if (!user) return reply.code(401).send({ error: 'not found' });
    const ok = await verify(user.passwordHash, parsed.data.password).catch(() => false);
    if (!ok) return reply.code(401).send({ error: 'current password incorrect' });

    const secret = generateSecretBase32();
    const ciphertext = encryptTotpSecret(key, uid, secret);
    // Upsert: an abandoned pending row is silently overwritten by the
    // next enrolment attempt. An already-active row is NOT overwritten
    // — disabling requires an explicit /disable flow.
    const [existing] = await db
      .select({ enabledAt: userTotp.enabledAt })
      .from(userTotp)
      .where(eq(userTotp.userId, uid))
      .limit(1);
    if (existing?.enabledAt) {
      return reply.code(409).send({ error: 'totp already enabled' });
    }
    if (existing) {
      await db.update(userTotp)
        .set({ secretCiphertext: ciphertext, updatedAt: new Date() })
        .where(eq(userTotp.userId, uid));
    } else {
      await db.insert(userTotp).values({
        userId: uid,
        secretCiphertext: ciphertext,
      });
    }

    return { secret, otpauthUrl: otpauthUrl(user.username, secret) };
  });

  // -- Confirm --------------------------------------------------------
  // Verifies the 6-digit code against the pending secret, activates the
  // row, generates and returns 10 recovery codes (the only time they
  // ever leave the server in plaintext).
  const ConfirmBody = z.object({ code: z.string().regex(/^\d{6}$/) });
  app.post('/api/auth/2fa/confirm', {
    preHandler: app.requireAuth,
    config: { rateLimit: RATE },
  }, async (req, reply) => {
    const parsed = ConfirmBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const uid = req.session.userId!;
    const [row] = await db
      .select()
      .from(userTotp)
      .where(eq(userTotp.userId, uid))
      .limit(1);
    if (!row) return reply.code(400).send({ error: 'no pending enrolment' });
    if (row.enabledAt) return reply.code(409).send({ error: 'totp already enabled' });
    const secret = decryptTotpSecret(key, uid, row.secretCiphertext);
    const confirmResult = verifyCode(secret, parsed.data.code);
    if (!confirmResult.ok) {
      return reply.code(401).send({ error: 'invalid code' });
    }

    // Generate + argon2-hash + insert in one transaction so a failure
    // mid-flight never leaves an activated row without codes.
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) codes.push(generateRecoveryCode());
    const hashes = await Promise.all(codes.map((c) => hash(normalizeRecoveryCode(c), ARGON2_OPTS)));

    await db.transaction(async (tx) => {
      // Stamp `last_used_counter` on activation so a snooped enrolment
      // code can't be replayed against /verify while the same window
      // is still open (RFC 6238 §5.2 replay defense).
      await tx.update(userTotp)
        .set({
          enabledAt: new Date(),
          updatedAt: new Date(),
          lastUsedCounter: confirmResult.counter,
        })
        .where(eq(userTotp.userId, uid));
      // Defensive cleanup: previous codes from a prior activation cycle
      // (should not exist here — /disable would have cascaded them —
      // but a manual DB tweak could leave orphans).
      await tx.delete(userTotpRecoveryCodes).where(eq(userTotpRecoveryCodes.userId, uid));
      await tx.insert(userTotpRecoveryCodes).values(
        hashes.map((codeHash) => ({ userId: uid, codeHash })),
      );
    });

    // Defensive: enrolment does not set totpPending, but clear it in
    // case a caller ever confuses the two flows.
    req.session.totpPending = false;
    return { recoveryCodes: codes };
  });

  // -- Verify — login-flow completion --------------------------------
  // Accepts either a 6-digit TOTP or an 8-char recovery code (dash
  // optional). Same rate-limit bucket as /login. Route path is on the
  // requireAuth allowlist so a totpPending session reaches it.
  const VerifyBody = z.object({ code: z.string().min(6).max(20) });
  app.post('/api/auth/2fa/verify', {
    preHandler: app.requireAuth,
    config: { rateLimit: RATE },
  }, async (req, reply) => {
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const uid = req.session.userId;
    if (!uid) return reply.code(401).send({ error: 'invalid credentials' });

    const [totpRow] = await db
      .select()
      .from(userTotp)
      .where(and(eq(userTotp.userId, uid), isNotNull(userTotp.enabledAt)))
      .limit(1);
    if (!totpRow) return reply.code(400).send({ error: 'totp not enabled' });

    const raw = parsed.data.code.trim();
    let matched = false;

    if (/^\d{6}$/.test(raw)) {
      const secret = decryptTotpSecret(key, uid, totpRow.secretCiphertext);
      const r = verifyCode(secret, raw);
      if (r.ok) {
        // Atomic replay guard: the UPDATE only lands when the row's
        // counter is still strictly below the matched one. A replay
        // (same code / same window / earlier code from the ±slop range)
        // hits `last_used_counter >= r.counter` and affects zero rows,
        // so `matched` stays false — same 401 shape as a wrong code.
        const upd = await db
          .update(userTotp)
          .set({ lastUsedCounter: r.counter })
          .where(and(eq(userTotp.userId, uid), lt(userTotp.lastUsedCounter, r.counter)))
          .returning({ userId: userTotp.userId });
        matched = upd.length > 0;
      }
    } else {
      // Recovery-code path. Constant-time match across RECOVERY_CODE_COUNT
      // argon2.verify calls (see matchRecoveryCodeConstantTime), then on a
      // hit burn the row transactionally alongside clearing the flag so a
      // concurrent retry can't double-spend.
      const normalized = normalizeRecoveryCode(raw);
      if (normalized.length >= 6) {
        const unused = await db
          .select({ id: userTotpRecoveryCodes.id, codeHash: userTotpRecoveryCodes.codeHash })
          .from(userTotpRecoveryCodes)
          .where(and(eq(userTotpRecoveryCodes.userId, uid), isNull(userTotpRecoveryCodes.usedAt)));
        const hit = await matchRecoveryCodeConstantTime(unused, normalized);
        if (hit) {
          const upd = await db
            .update(userTotpRecoveryCodes)
            .set({ usedAt: new Date() })
            .where(and(
              eq(userTotpRecoveryCodes.id, hit.id),
              isNull(userTotpRecoveryCodes.usedAt),
            ))
            .returning({ id: userTotpRecoveryCodes.id });
          matched = upd.length > 0;
        }
      }
    }

    if (!matched) return reply.code(401).send({ error: 'invalid code' });

    // Rotate the session id on second-factor completion — fixation
    // defence. Explicit save() closes a race on the recovery path
    // (implicit onSend save trailed the response).
    const username = req.session.username;
    await req.session.regenerate();
    req.session.userId = uid;
    req.session.username = username;
    req.session.totpPending = false;
    await req.session.save();
    return { user: { id: uid, username } };
  });

  // -- Disable --------------------------------------------------------
  // Requires the account password AND a current TOTP/recovery code.
  // Prevents both "leaked password disables 2FA" and "stolen device
  // disables 2FA" as sole failure modes.
  const DisableBody = z.object({
    password: z.string().min(1),
    code: z.string().min(6).max(20),
  });
  app.post('/api/auth/2fa/disable', {
    preHandler: app.requireAuth,
    config: { rateLimit: RATE },
  }, async (req, reply) => {
    const parsed = DisableBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const uid = req.session.userId!;
    const [user] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    if (!user) return reply.code(401).send({ error: 'not found' });
    const passOk = await verify(user.passwordHash, parsed.data.password).catch(() => false);
    if (!passOk) return reply.code(401).send({ error: 'current password incorrect' });

    const [totpRow] = await db
      .select()
      .from(userTotp)
      .where(and(eq(userTotp.userId, uid), isNotNull(userTotp.enabledAt)))
      .limit(1);
    if (!totpRow) return reply.code(400).send({ error: 'totp not enabled' });

    const raw = parsed.data.code.trim();
    let codeOk = false;
    if (/^\d{6}$/.test(raw)) {
      const secret = decryptTotpSecret(key, uid, totpRow.secretCiphertext);
      const r = verifyCode(secret, raw);
      if (r.ok) {
        // Same replay guard as /verify: an atomic conditional UPDATE.
        // The row is about to be deleted below on success, but that
        // delete only fires after this check — a replay window before
        // the delete lands still needs the counter bump to reject.
        const upd = await db
          .update(userTotp)
          .set({ lastUsedCounter: r.counter })
          .where(and(eq(userTotp.userId, uid), lt(userTotp.lastUsedCounter, r.counter)))
          .returning({ userId: userTotp.userId });
        codeOk = upd.length > 0;
      }
    } else {
      const normalized = normalizeRecoveryCode(raw);
      if (normalized.length >= 6) {
        const unused = await db
          .select({ id: userTotpRecoveryCodes.id, codeHash: userTotpRecoveryCodes.codeHash })
          .from(userTotpRecoveryCodes)
          .where(and(eq(userTotpRecoveryCodes.userId, uid), isNull(userTotpRecoveryCodes.usedAt)));
        codeOk = (await matchRecoveryCodeConstantTime(unused, normalized)) !== null;
      }
    }
    if (!codeOk) return reply.code(401).send({ error: 'invalid code' });

    // Cascade wipes the recovery codes via ON DELETE CASCADE.
    await db.delete(userTotp).where(eq(userTotp.userId, uid));
    return { ok: true };
  });

  // -- Regenerate recovery codes -------------------------------------
  // Password re-entry gate; leaves the TOTP secret intact.
  const RegenBody = z.object({ password: z.string().min(1) });
  app.post('/api/auth/2fa/regenerate-codes', {
    preHandler: app.requireAuth,
    config: { rateLimit: RATE },
  }, async (req, reply) => {
    const parsed = RegenBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const uid = req.session.userId!;
    const [user] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    if (!user) return reply.code(401).send({ error: 'not found' });
    const ok = await verify(user.passwordHash, parsed.data.password).catch(() => false);
    if (!ok) return reply.code(401).send({ error: 'current password incorrect' });

    const [totpRow] = await db
      .select({ enabledAt: userTotp.enabledAt })
      .from(userTotp)
      .where(eq(userTotp.userId, uid))
      .limit(1);
    if (!totpRow?.enabledAt) return reply.code(400).send({ error: 'totp not enabled' });

    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) codes.push(generateRecoveryCode());
    const hashes = await Promise.all(codes.map((c) => hash(normalizeRecoveryCode(c), ARGON2_OPTS)));

    await db.transaction(async (tx) => {
      await tx.delete(userTotpRecoveryCodes).where(eq(userTotpRecoveryCodes.userId, uid));
      await tx.insert(userTotpRecoveryCodes).values(
        hashes.map((codeHash) => ({ userId: uid, codeHash })),
      );
    });

    return { recoveryCodes: codes };
  });

  // Exposed for tests: peek at the current TOTP code the server would
  // accept, without going through decrypt+HMAC in the test. Two
  // independent gates so a misdeployed image with `NODE_ENV=test` alone
  // (Docker --env-file typo, CI artefact pushed to prod) can't leak
  // live TOTP codes to whoever knows the URL — the test harness
  // (tests/setup.ts) sets ATHENA_TEST_ROUTES=1 too. `?offset=<int>`
  // shifts the counter by n × 30 s so replay-protected verify tests can
  // grab a fresh-counter code without waiting a real clock window.
  if (process.env.NODE_ENV === 'test' && process.env.ATHENA_TEST_ROUTES === '1') {
    app.get('/api/auth/2fa/__debug/current-code', { preHandler: app.requireAuth }, async (req, reply) => {
      const uid = req.session.userId!;
      const [row] = await db.select().from(userTotp).where(eq(userTotp.userId, uid)).limit(1);
      if (!row) return reply.code(404).send({ error: 'no totp row' });
      const secret = decryptTotpSecret(key, uid, row.secretCiphertext);
      const offset = Number((req.query as { offset?: string })?.offset ?? 0);
      const atSec = Math.floor(Date.now() / 1000) + (Number.isFinite(offset) ? offset : 0) * 30;
      return { code: generateCode(secret, atSec) };
    });
  }
}
