import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, Algorithm } from '@node-rs/argon2';
import { count } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';

// OWASP 2024 minimum for argon2id: 19 MiB memory, 2 iterations, parallelism 1.
const ARGON2_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const CreateBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(256),
});

async function hasUser(): Promise<boolean> {
  const [row] = await db.select({ c: count() }).from(users);
  return (row?.c ?? 0) > 0;
}

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/onboarding/status', async () => {
    return { needsOnboarding: !(await hasUser()) };
  });

  app.post('/api/onboarding/create', async (req, reply) => {
    // Multi-user mode (migration 0007): the endpoint now accepts new
    // registrations after the first user. Behaves as "register" once the
    // initial onboarding is past. Open by design because the app is LAN-only;
    // restrict via firewall/VPN if you need stricter control.
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const { username, password } = parsed.data;

    const passwordHash = await hash(password, ARGON2_OPTS);

    let user: { id: number; username: string } | undefined;
    try {
      const inserted = await db
        .insert(users)
        .values({ username, passwordHash })
        .returning({ id: users.id, username: users.username });
      user = inserted[0];
    } catch (err: any) {
      // 23505 is unique_violation on the users_username_unique constraint.
      if (err?.code === '23505') {
        return reply.code(409).send({ error: 'username already taken' });
      }
      throw err;
    }

    if (!user) {
      return reply.code(500).send({ error: 'failed to create user' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    return reply.code(201).send({ user });
  });
}
