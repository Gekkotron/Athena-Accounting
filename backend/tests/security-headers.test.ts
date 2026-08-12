// Verifies @fastify/helmet is wired into buildServer with the LAN-appropriate
// config (see buildServer.ts). The Docker path also has an nginx layer that
// stamps these headers, but the Tauri desktop sidecar has no proxy in front,
// so these assertions guard that path directly. Runs on the fast lane —
// tests/setup.ts primes PGlite + SESSION_SECRET, GET /health only touches
// SELECT 1 so no migrations are needed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

describe('security headers (@fastify/helmet)', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('stamps X-Frame-Options: DENY on responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('stamps X-Content-Type-Options: nosniff', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('stamps Referrer-Policy: no-referrer', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('leaves CSP off — nginx handles it for Docker, Tauri WebView owns doc policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('leaves HSTS off — app is LAN-only, mostly http://', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});
