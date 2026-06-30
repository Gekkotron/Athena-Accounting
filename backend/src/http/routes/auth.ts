import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';

const ARGON2_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const LoginBody = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

// Precompute a dummy hash once so a login attempt for a non-existent user
// takes roughly the same time as a real verify — defeats username enumeration
// via response timing.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hash('athena-dummy-password-for-timing-stability', ARGON2_OPTS);
  }
  return dummyHashPromise;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Login is the prime brute-force target. 10 attempts per IP per minute is
  // enough for the legitimate "I mistyped my password three times" case while
  // making automated guessing a non-starter.
  app.post('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input' });
    }
    const { username, password } = parsed.data;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user) {
      // Burn comparable CPU so the response time doesn't reveal whether the
      // user exists.
      await verify(await getDummyHash(), password).catch(() => false);
      return reply.code(401).send({ error: 'invalid credentials' });
    }

    const ok = await verify(user.passwordHash, password);
    if (!ok) return reply.code(401).send({ error: 'invalid credentials' });

    // Rotate the session id on login to prevent session fixation.
    await req.session.regenerate();
    req.session.userId = user.id;
    req.session.username = user.username;

    return { user: { id: user.id, username: user.username } };
  });

  app.post(
    '/api/auth/logout',
    { preHandler: app.requireAuth },
    async (req) => {
      await req.session.destroy();
      return { ok: true };
    },
  );

  app.get(
    '/api/auth/me',
    { preHandler: app.requireAuth },
    async (req) => {
      return {
        user: { id: req.session.userId, username: req.session.username },
      };
    },
  );

  // Profile update. Username and/or password change. Current password is
  // always required so a leaked session can't quietly change the password
  // and lock the real user out.
  const ProfileBody = z
    .object({
      username: z.string().trim().min(1).max(64).optional(),
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(256).optional(),
    })
    .refine((d) => d.username !== undefined || d.newPassword !== undefined, {
      message: 'username or newPassword required',
    });

  app.patch(
    '/api/auth/me',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const parsed = ProfileBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
      }
      const { username, currentPassword, newPassword } = parsed.data;
      const sessionUid = req.session.userId!;
      const [user] = await db.select().from(users).where(eq(users.id, sessionUid)).limit(1);
      if (!user) return reply.code(401).send({ error: 'not found' });

      const ok = await verify(user.passwordHash, currentPassword);
      if (!ok) return reply.code(401).send({ error: 'current password incorrect' });

      const updates: { username?: string; passwordHash?: string } = {};
      if (username && username !== user.username) updates.username = username;
      if (newPassword) updates.passwordHash = await hash(newPassword, ARGON2_OPTS);
      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: 'nothing to change' });
      }

      try {
        const [updated] = await db
          .update(users)
          .set(updates)
          .where(eq(users.id, sessionUid))
          .returning({ id: users.id, username: users.username });
        if (!updated) return reply.code(500).send({ error: 'update failed' });
        if (updates.username) req.session.username = updated.username;
        return { user: updated };
      } catch (err: any) {
        if (err?.code === '23505') return reply.code(409).send({ error: 'username already taken' });
        throw err;
      }
    },
  );
}
