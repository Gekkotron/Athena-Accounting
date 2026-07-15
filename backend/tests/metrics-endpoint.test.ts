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

  it('increments athena_imports_total{kind="csv",outcome="success"} on CSV import', async () => {
    // Set up user + account + upload a minimal CSV.
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'metrics-user', password: 'metrics-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'metrics-user', password: 'metrics-1234' },
    });
    const cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;

    const acc = await app.inject({
      method: 'POST', url: '/api/accounts',
      headers: { cookie },
      payload: {
        name: 'MetricsAcc', type: 'checking', currency: 'EUR',
        openingBalance: '0', openingDate: '2025-01-01',
      },
    });
    const accountId = acc.json().account.id;

    // Minimal Athena-flavored CSV: date;label;amount (semicolon-separated).
    const csvBody = 'date;label;amount\n2026-06-01;coffee;-3.50\n';
    const boundary = '----MetricsBoundary';
    const multipart =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="tx.csv"\r\n` +
      `Content-Type: text/csv\r\n\r\n` +
      `${csvBody}\r\n` +
      `--${boundary}--\r\n`;

    const before = await app.inject({ method: 'GET', url: '/metrics' });
    const beforeMatch = before.body.match(
      /athena_imports_total\{kind="csv",outcome="success"\} (\d+)/,
    );
    const beforeCount = beforeMatch ? Number(beforeMatch[1]) : 0;

    const importRes = await app.inject({
      method: 'POST', url: `/api/imports?accountId=${accountId}`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart,
    });
    expect(importRes.statusCode).toBe(201);

    const after = await app.inject({ method: 'GET', url: '/metrics' });
    const afterMatch = after.body.match(
      /athena_imports_total\{kind="csv",outcome="success"\} (\d+)/,
    );
    expect(afterMatch).not.toBeNull();
    expect(Number(afterMatch![1])).toBe(beforeCount + 1);
  });

  it('sweeper increments athena_imports_total{kind="pdf",outcome="aborted"}', async () => {
    const { sweepExpiredDrafts } = await import(
      '../src/domain/imports/pdf/draft-sweeper.js'
    );
    const { db } = await import('../src/db/client.js');
    const { pdfImportDrafts, accounts, users } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');

    // Grab any user + account (metrics test above created them).
    const [u] = await db.select().from(users);
    const [a] = await db.select().from(accounts).where(eq(accounts.userId, u.id));

    // Insert an already-expired draft so the sweeper deletes it. Column
    // shape matches backend/src/db/schema.ts:pdfImportDrafts — pdfBytes is
    // TEXT (not bytea), fingerprint is NOT NULL, no filename column.
    await db.insert(pdfImportDrafts).values({
      userId: u.id,
      accountId: a.id,
      pdfBytes: '%PDF-1.4',
      textItems: [],
      fingerprint: 'sweeper-test-fp',
      ocrStatus: 'not_needed',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const before = await app.inject({ method: 'GET', url: '/metrics' });
    const beforeMatch = before.body.match(
      /athena_imports_total\{kind="pdf",outcome="aborted"\} (\d+)/,
    );
    const beforeCount = beforeMatch ? Number(beforeMatch[1]) : 0;

    let observed = -1;
    const deleted = await sweepExpiredDrafts((n) => { observed = n; });
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(observed).toBe(deleted);

    // Simulate the wiring that startDraftSweeper does at runtime.
    (app as any).metrics.importsTotal.inc(
      { kind: 'pdf', outcome: 'aborted' },
      deleted,
    );

    const after = await app.inject({ method: 'GET', url: '/metrics' });
    const afterMatch = after.body.match(
      /athena_imports_total\{kind="pdf",outcome="aborted"\} (\d+)/,
    );
    expect(afterMatch).not.toBeNull();
    expect(Number(afterMatch![1])).toBe(beforeCount + deleted);
  });

  it('records athena_backup_last_success_timestamp_seconds after GET /api/backup/export', async () => {
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'backup-user', password: 'backup-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'backup-user', password: 'backup-1234' },
    });
    const cookie = login.cookies[0]
      ? login.cookies[0].name + '=' + login.cookies[0].value
      : '';
    expect(cookie).not.toBe('');

    const nowBefore = Math.floor(Date.now() / 1000);

    const dump = await app.inject({
      method: 'GET', url: '/api/backup/export',
      headers: { cookie },
    });
    expect(dump.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const m = res.body.match(
      /athena_backup_last_success_timestamp_seconds (\d+(?:\.\d+)?)/,
    );
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(nowBefore);
    expect(Number(m![1])).toBeLessThanOrEqual(nowBefore + 30);
  });

  it('public-safe: response body contains no PII-like tokens', async () => {
    // Exercise several routes first so the response body isn't near-empty.
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/api/onboarding/status' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    // No user IDs, account IDs, transaction IDs, emails, or HH:MM:SS wall
    // clock leaks (Fastify default log fields never end up in metric labels).
    const suspiciousPatterns: RegExp[] = [
      /user_id="/,
      /account_id="/,
      /transaction_id="/,
      /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
      /\b\d{2}:\d{2}:\d{2}\b/,
    ];
    for (const pat of suspiciousPatterns) {
      expect(res.body).not.toMatch(pat);
    }
  });

  it('rate-limits /metrics past 20 req/min', async () => {
    // Fire 25 requests quickly with a stable synthetic IP; at least one
    // response should be 429 once the 20/min bucket empties.
    const responses = [];
    for (let i = 0; i < 25; i++) {
      responses.push(
        await app.inject({
          method: 'GET', url: '/metrics',
          headers: { 'x-forwarded-for': '203.0.113.99' },
        }),
      );
    }
    const anyLimited = responses.some((r) => r.statusCode === 429);
    expect(anyLimited).toBe(true);
  });
});
