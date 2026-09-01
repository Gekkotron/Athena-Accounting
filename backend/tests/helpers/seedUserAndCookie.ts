import type { FastifyInstance } from 'fastify';

// Onboards a fresh user through the real HTTP flow (POST /api/onboarding/create
// + POST /api/auth/login) and returns a signed session cookie plus the user's
// id. Route tests behind `requireAuth` need a real session — seedUser.ts's
// direct DB insert stores a placeholder passwordHash ('x') that isn't a valid
// argon2 hash to log in against, so it can't produce a cookie by itself.
// Username is randomized per call so repeated invocations don't collide on
// the unique index.
export async function seedUserAndCookie(
  app: FastifyInstance,
): Promise<{ cookie: string; uid: number }> {
  const username = `notif-user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const password = 'notifications-test-pw';

  await app.inject({
    method: 'POST', url: '/api/onboarding/create',
    payload: { username, password },
  });
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { username, password },
  });
  const cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  const uid = login.json().user.id as number;
  return { cookie, uid };
}
