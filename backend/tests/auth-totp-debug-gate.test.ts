// Security-audit regression guard: /api/auth/2fa/__debug/current-code
// exposes a live TOTP code and MUST be gated by TWO independent env
// checks (NODE_ENV=test AND ATHENA_TEST_ROUTES=1) so a misdeployed image
// (Docker --env-file typo, CI artefact pushed to prod) with only one of
// them set can't leak it. Requires RUN_DB_TESTS=1 to boot the app.
import { describe, it, expect } from 'vitest';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

d('/api/auth/2fa/__debug/current-code — dual-gate', () => {
  it('is not mounted when ATHENA_TEST_ROUTES is unset', async () => {
    // buildApp is invoked WITH the co-gate cleared, so totpRoutes'
    // `if (NODE_ENV === 'test' && ATHENA_TEST_ROUTES === '1')` fails
    // and the route is never registered. Restore + rebuild is scoped
    // to this test.
    const prior = process.env.ATHENA_TEST_ROUTES;
    delete process.env.ATHENA_TEST_ROUTES;
    try {
      const { buildApp } = await import('./helpers/build-app.js');
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET', url: '/api/auth/2fa/__debug/current-code',
      });
      // Route not mounted → Fastify returns 404 (before requireAuth).
      expect(res.statusCode).toBe(404);
      await app.close();
    } finally {
      if (prior !== undefined) process.env.ATHENA_TEST_ROUTES = prior;
    }
  });

  it('is mounted when both NODE_ENV=test AND ATHENA_TEST_ROUTES=1 are set', async () => {
    process.env.ATHENA_TEST_ROUTES = '1';
    const { buildApp } = await import('./helpers/build-app.js');
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET', url: '/api/auth/2fa/__debug/current-code',
    });
    // Route mounted → requireAuth blocks the unauthenticated caller
    // (401), which proves the route exists (vs. the 404 above).
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
