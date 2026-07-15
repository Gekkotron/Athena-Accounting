// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;

describe.skipIf(!RUN)('/metrics endpoint', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /metrics returns Prometheus text with 200 and no auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    // prom-client default metrics ship at least these:
    expect(res.body).toMatch(/# HELP process_cpu_seconds_total/);
    expect(res.body).toMatch(/# TYPE process_cpu_seconds_total counter/);
  });

  it('exposes app.metrics decoration', () => {
    expect((app as any).metrics).toBeDefined();
  });

  it('counts HTTP requests to business routes with route template + status_class', async () => {
    // /api/onboarding/status is a public GET always available.
    await app.inject({ method: 'GET', url: '/api/onboarding/status' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toMatch(
      /athena_http_requests_total\{method="GET",route="\/api\/onboarding\/status",status_class="2xx"\} \d+/,
    );
    expect(res.body).toMatch(
      /athena_http_request_duration_seconds_count\{method="GET",route="\/api\/onboarding\/status",status_class="2xx"\} \d+/,
    );
  });

  it('excludes /metrics and /health from the HTTP hook', async () => {
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/metrics' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).not.toMatch(/route="\/health"/);
    expect(res.body).not.toMatch(/route="\/metrics"/);
  });

  it('labels unmatched routes as route="unmatched"', async () => {
    await app.inject({ method: 'GET', url: '/api/definitely-does-not-exist' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toMatch(
      /athena_http_requests_total\{method="GET",route="unmatched",status_class="4xx"\} \d+/,
    );
  });

  it('exposes athena_db_size_bytes with a positive value', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const m = res.body.match(/athena_db_size_bytes (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
  });

  it('exposes athena_transactions_total as a numeric gauge', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toMatch(/# TYPE athena_transactions_total gauge/);
    expect(res.body).toMatch(/athena_transactions_total \d+/);
  });

  it('exposes athena_accounts_total as a numeric gauge', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toMatch(/# TYPE athena_accounts_total gauge/);
    expect(res.body).toMatch(/athena_accounts_total \d+/);
  });
});
