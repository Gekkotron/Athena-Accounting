# Prometheus `/metrics` endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Prometheus-compatible `GET /metrics` endpoint to the Fastify backend, exposing HTTP request counters/latency, imports counter, DB size/count gauges, backup freshness gauge, and standard Node.js runtime metrics.

**Architecture:** One new Fastify plugin (`backend/src/http/plugins/metrics.ts`) registers all metrics on a private `prom-client` `Registry`, decorates them on `app.metrics`, installs an `onResponse` hook for HTTP metrics + backup timestamp, and exposes `GET /metrics` (unauthenticated, rate-limited). Gauges use prom-client's async `collect()` so DB queries only run at scrape time. Manual counter increments live in `imports.ts` (imports success/error) and `draft-sweeper.ts` (aborted).

**Tech Stack:** Node 20+, Fastify 5, `fastify-plugin`, `prom-client` (new dep), Drizzle + `pg`, Vitest.

## Global Constraints

- **Public-safe labels only**: `method`, `route`, `status_class`, `kind`, `outcome`. Never user IDs, account IDs, transaction IDs, filenames, hostnames, IPs, or emails.
- **`route` label**: always the Fastify route template (e.g. `/api/accounts/:id`) via `req.routeOptions?.url`, never the raw URL. Unmatched → `route="unmatched"`.
- **`status_class` label**: `2xx | 3xx | 4xx | 5xx` (bucketed, not raw status).
- **Metric name prefix**: `athena_` for all custom metrics.
- **No auth** on `/metrics`. **Rate-limit**: 20 req/min per IP via `config.rateLimit`.
- **Registration order in `server.ts`**: `metricsPlugin` registered **after** `rateLimit` (so `config.rateLimit` applies) and **before** `authPlugin` (so `/metrics` sees no session).
- **Node version**: `>=20.11` per `backend/package.json`.
- **Commit style**: `feat(metrics): …` / `test(metrics): …` / `docs(metrics): …`. Commit as `Gekkotron <60887050+Gekkotron@users.noreply.github.com>`, using `-c user.name=Gekkotron -c user.email=…` on every `git commit`. Do NOT modify `.git/config`. Do NOT push (project convention: main-only, push when asked).
- **Test gate**: DB-touching tests run under `RUN_DB_TESTS=1` and use `buildApp()` from `backend/tests/helpers/build-app.ts` + `describe.skipIf(!RUN)`.

## File Structure

**Created:**
- `backend/src/http/plugins/metrics.ts` — the plugin. Declares registry, custom metrics, HTTP hook, `/metrics` route. Decorates `app.metrics`. ~150 LoC.
- `backend/tests/metrics-endpoint.test.ts` — full suite for the plugin.

**Modified:**
- `backend/package.json` — add `prom-client` dependency.
- `backend/src/server.ts` — register `metricsPlugin` between `rateLimit` and `authPlugin`.
- `backend/src/http/routes/imports.ts` — call `app.metrics.importsTotal.inc(...)` on each user-facing import outcome.
- `backend/src/domain/imports/pdf/draft-sweeper.ts` — accept an `onAborted?: (count: number) => void` callback and invoke it after each sweep. `startDraftSweeper` wires it to the metrics counter.

**Note on `backup/export.ts`**: no code change there — the timestamp update lives inside the metrics plugin's `onResponse` hook (condition: `url === '/api/backup/export' && statusCode < 400`). Keeps side effects centralized.

---

### Task 1: Foundation — dep, plugin skeleton, `/metrics` route, `server.ts` wiring

**Files:**
- Modify: `backend/package.json` (add `prom-client` to `dependencies`)
- Create: `backend/src/http/plugins/metrics.ts` (~40 LoC at end of this task)
- Modify: `backend/src/server.ts` (register plugin between `rateLimit` and `authPlugin`)
- Create: `backend/tests/metrics-endpoint.test.ts` (first two cases)

**Interfaces:**
- Produces:
  - `metricsPlugin: FastifyPluginAsync` — the exported plugin function (fp-wrapped).
  - `app.metrics: MetricsBag` — decorated on the FastifyInstance. In this task, `MetricsBag = {}` (empty). Later tasks add fields.

- [ ] **Step 1: Add `prom-client` dependency**

Run from `backend/` directory:

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
npm install prom-client
```

Expected: `prom-client` added to `dependencies` in `backend/package.json` (a stable version, currently `^15.x`). `package-lock.json` updated.

- [ ] **Step 2: Verify install**

```bash
node -e "console.log(require('prom-client').register.contentType)"
```

Expected output: `text/plain; version=0.0.4; charset=utf-8`

- [ ] **Step 3: Write the failing test (skeleton)**

Create `backend/tests/metrics-endpoint.test.ts`:

```ts
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
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: FAIL — both cases fail because `/metrics` returns 404 (route not registered) and `app.metrics` is undefined.

- [ ] **Step 5: Create the plugin skeleton**

Create `backend/src/http/plugins/metrics.ts`:

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { Registry, collectDefaultMetrics } from 'prom-client';

export type MetricsBag = Record<string, never>;

declare module 'fastify' {
  interface FastifyInstance {
    metrics: MetricsBag;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  app.decorate('metrics', {} as MetricsBag);

  app.get('/metrics', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
};

export const metricsPlugin = fp(plugin, { name: 'metrics' });
```

- [ ] **Step 6: Wire into `server.ts`**

Edit `backend/src/server.ts`:

Add import near the other plugin imports:
```ts
import { metricsPlugin } from './http/plugins/metrics.js';
```

Change the registration block from:
```ts
  await app.register(multipart);
  // Rate limiting. Global default is permissive (300 req/min) — the actual
  // protection is the per-route config on /api/auth/login and
  // /api/onboarding/create, which are stricter. Keyed on the client IP.
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
  });
  await app.register(authPlugin);
```

to:

```ts
  await app.register(multipart);
  // Rate limiting. Global default is permissive (300 req/min) — the actual
  // protection is the per-route config on /api/auth/login and
  // /api/onboarding/create, which are stricter. Keyed on the client IP.
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
  });
  await app.register(metricsPlugin);
  await app.register(authPlugin);
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: PASS — both cases green.

- [ ] **Step 8: Run the full test suite (nothing else regresses)**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test
```

Expected: full suite PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/package.json backend/package-lock.json backend/src/http/plugins/metrics.ts backend/src/server.ts backend/tests/metrics-endpoint.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(metrics): scaffold prom-client plugin + GET /metrics route

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: HTTP request counter + histogram + `onResponse` hook

**Files:**
- Modify: `backend/src/http/plugins/metrics.ts` (add two metrics + hook)
- Modify: `backend/tests/metrics-endpoint.test.ts` (add ~4 cases)

**Interfaces:**
- Consumes: `app.metrics` from Task 1 (currently empty).
- Produces:
  - `app.metrics.httpRequestsTotal: Counter` — labels `{method, route, status_class}`.
  - `app.metrics.httpRequestDurationSeconds: Histogram` — labels `{method, route, status_class}`.
  - HTTP `onResponse` hook active on every route registered **after** `metricsPlugin` in `server.ts`.

- [ ] **Step 1: Write the failing tests**

Add these cases inside `describe.skipIf(!RUN)('/metrics endpoint', …)` in `backend/tests/metrics-endpoint.test.ts` (append after the existing cases):

```ts
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
```

- [ ] **Step 2: Run to verify the new tests fail**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: three new cases FAIL (regexes don't match), original two still PASS.

- [ ] **Step 3: Extend the plugin with HTTP metrics + hook**

Edit `backend/src/http/plugins/metrics.ts`. Replace the file content with:

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  Registry,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

export interface MetricsBag {
  httpRequestsTotal: Counter<'method' | 'route' | 'status_class'>;
  httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status_class'>;
}

declare module 'fastify' {
  interface FastifyInstance {
    metrics: MetricsBag;
  }
}

const HISTOGRAM_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

function statusClass(code: number): string {
  return `${Math.floor(code / 100)}xx`;
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const httpRequestsTotal = new Counter({
    name: 'athena_http_requests_total',
    help: 'Count of HTTP requests, labeled by method, Fastify route template, and status class.',
    labelNames: ['method', 'route', 'status_class'] as const,
    registers: [registry],
  });

  const httpRequestDurationSeconds = new Histogram({
    name: 'athena_http_request_duration_seconds',
    help: 'HTTP request duration in seconds, labeled by method, route template, and status class.',
    labelNames: ['method', 'route', 'status_class'] as const,
    buckets: HISTOGRAM_BUCKETS,
    registers: [registry],
  });

  app.decorate('metrics', {
    httpRequestsTotal,
    httpRequestDurationSeconds,
  } as MetricsBag);

  app.addHook('onResponse', async (req, reply) => {
    const url = req.routeOptions?.url ?? 'unmatched';
    if (url === '/metrics' || url === '/health') return;
    const method = req.method;
    const klass = statusClass(reply.statusCode);
    httpRequestsTotal.inc({ method, route: url, status_class: klass });
    // Fastify exposes elapsedTime in milliseconds.
    httpRequestDurationSeconds.observe(
      { method, route: url, status_class: klass },
      reply.elapsedTime / 1000,
    );
  });

  app.get('/metrics', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
};

export const metricsPlugin = fp(plugin, { name: 'metrics' });
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: all five cases PASS.

- [ ] **Step 5: Run full test suite (no regression on other tests using inject)**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test
```

Expected: full suite PASS. If any pre-existing test asserts a specific reply body shape, this task doesn't touch it — regressions would indicate an unrelated bug.

- [ ] **Step 6: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/src/http/plugins/metrics.ts backend/tests/metrics-endpoint.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(metrics): HTTP request counter + latency histogram via onResponse

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Async gauges — DB size, transactions total, accounts total

**Files:**
- Modify: `backend/src/http/plugins/metrics.ts` (add three gauges + import `pool`)
- Modify: `backend/tests/metrics-endpoint.test.ts` (add ~3 cases)

**Interfaces:**
- Consumes: `pool` from `backend/src/db/client.ts` (already used elsewhere in the codebase).
- Produces:
  - `app.metrics.dbSizeBytes: Gauge`
  - `app.metrics.transactionsTotal: Gauge`
  - `app.metrics.accountsTotal: Gauge`
  - All three use async `collect()`. `metrics()` output on scrape shows them with numeric values ≥ 0.

**Note on schema (verified against `backend/src/db/schema.ts`):**
- `accounts` table has no `archived_at` or `deleted_at` column. → `SELECT COUNT(*) FROM accounts`.
- `transactions` table has no `deleted_at` column either. → `SELECT COUNT(*) FROM transactions`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/metrics-endpoint.test.ts` inside the same `describe`:

```ts
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
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: three new cases FAIL (gauges don't exist yet).

- [ ] **Step 3: Extend the plugin with async gauges**

Edit `backend/src/http/plugins/metrics.ts`:

Add to the imports at the top:
```ts
import { Gauge } from 'prom-client';
import { pool } from '../../db/client.js';
```

Update the `MetricsBag` interface:
```ts
export interface MetricsBag {
  httpRequestsTotal: Counter<'method' | 'route' | 'status_class'>;
  httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status_class'>;
  dbSizeBytes: Gauge<string>;
  transactionsTotal: Gauge<string>;
  accountsTotal: Gauge<string>;
}
```

Add the three gauges after the histogram declaration and before the `app.decorate` call. Each uses async `collect()` so the query only runs on scrape. Errors are caught and logged; the gauge keeps its last value.

```ts
  const dbSizeBytes = new Gauge({
    name: 'athena_db_size_bytes',
    help: 'Size in bytes of the current Postgres database (pg_database_size).',
    registers: [registry],
    async collect() {
      try {
        const { rows } = await pool.query(
          "SELECT pg_database_size(current_database())::bigint AS s",
        );
        this.set(Number(rows[0].s));
      } catch (err) {
        app.log.warn({ err }, 'athena_db_size_bytes collect failed');
      }
    },
  });

  const transactionsTotal = new Gauge({
    name: 'athena_transactions_total',
    help: 'Total number of transactions across all users.',
    registers: [registry],
    async collect() {
      try {
        const { rows } = await pool.query(
          'SELECT COUNT(*)::bigint AS n FROM transactions',
        );
        this.set(Number(rows[0].n));
      } catch (err) {
        app.log.warn({ err }, 'athena_transactions_total collect failed');
      }
    },
  });

  const accountsTotal = new Gauge({
    name: 'athena_accounts_total',
    help: 'Total number of accounts across all users.',
    registers: [registry],
    async collect() {
      try {
        const { rows } = await pool.query(
          'SELECT COUNT(*)::bigint AS n FROM accounts',
        );
        this.set(Number(rows[0].n));
      } catch (err) {
        app.log.warn({ err }, 'athena_accounts_total collect failed');
      }
    },
  });
```

Update the `app.decorate('metrics', {...})` block to include the three gauges:

```ts
  app.decorate('metrics', {
    httpRequestsTotal,
    httpRequestDurationSeconds,
    dbSizeBytes,
    transactionsTotal,
    accountsTotal,
  } as MetricsBag);
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: eight cases total PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test
```

Expected: full suite PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/src/http/plugins/metrics.ts backend/tests/metrics-endpoint.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(metrics): DB size + transactions/accounts count gauges (async collect)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Imports counter — wire increments in `imports.ts`

**Files:**
- Modify: `backend/src/http/plugins/metrics.ts` (declare counter)
- Modify: `backend/src/http/routes/imports.ts` (five increment sites)
- Modify: `backend/tests/metrics-endpoint.test.ts` (add one case using the CSV import path)

**Interfaces:**
- Consumes: `app.metrics.importsTotal` (declared in this task).
- Produces:
  - `app.metrics.importsTotal: Counter<'kind' | 'outcome'>` — `kind ∈ {ofx, qfx, csv, pdf, photo}`, `outcome ∈ {success, error}`. (The `aborted` outcome is added in Task 5.)
  - Increments in `POST /api/imports` (CSV/OFX/QFX success + error, PDF success/draft-no-error + error), `POST /api/imports/pdf/templates` (apply-template success + error), `POST /api/imports/photo` (success + error).

**Design note on `kind`**: `POST /api/imports` calls `inferFormat(filename)` which returns `'ofx' | 'qfx' | 'csv' | 'pdf' | null`. We reuse this string verbatim as the `kind` label — it stays public-safe (5-element enum from source code, no user-controlled data). `POST /api/imports/photo` uses `kind: 'photo'`. The apply-template route (`POST /api/imports/pdf/templates`) uses `kind: 'pdf'` since it finalizes a PDF draft.

**Semantic clarification on `outcome`**: `success` means "rows were inserted into the DB", `error` means "the handler returned a 4xx/5xx with an explicit error message". A PDF returning `{kind:'draft'}` (template unknown, awaiting user zone selection) is neither — it's a pending state, so it does NOT increment either counter. Only the `applyTemplateAndImport` finalization counts as `success`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/metrics-endpoint.test.ts` inside the same `describe`. This test needs a signed-in user + an account:

```ts
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
```

- [ ] **Step 2: Run to verify test fails**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: the new case FAILS (counter does not exist / afterMatch is null).

- [ ] **Step 3: Declare the counter in the plugin**

Edit `backend/src/http/plugins/metrics.ts`.

Update the `MetricsBag` interface — add:

```ts
  importsTotal: Counter<'kind' | 'outcome'>;
```

Add the counter declaration after the existing gauges, before the `app.decorate` call:

```ts
  const importsTotal = new Counter({
    name: 'athena_imports_total',
    help: 'Count of import attempts, labeled by kind (ofx|qfx|csv|pdf|photo) and outcome (success|error|aborted).',
    labelNames: ['kind', 'outcome'] as const,
    registers: [registry],
  });
```

Update `app.decorate('metrics', {...})` to include `importsTotal`:

```ts
  app.decorate('metrics', {
    httpRequestsTotal,
    httpRequestDurationSeconds,
    dbSizeBytes,
    transactionsTotal,
    accountsTotal,
    importsTotal,
  } as MetricsBag);
```

- [ ] **Step 4: Wire increments in `imports.ts`**

Edit `backend/src/http/routes/imports.ts`. Update the three handlers as follows.

**`POST /api/imports`** — replace the entire handler body (lines 49-104 in current file). Below is the full replacement:

```ts
  app.post('/api/imports', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'no file uploaded' });
    const data = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });
    const filename = data.filename;
    const buffer = await data.toBuffer();
    const format = inferFormat(filename);
    if (!format) {
      return reply.code(400).send({ error: 'unsupported file extension (expected .ofx, .qfx, .csv, or .pdf)' });
    }

    const q = req.query as { accountId?: string };
    let accountId: number | null = null;
    if (q.accountId) {
      const n = Number(q.accountId);
      if (!Number.isInteger(n) || n <= 0) {
        return reply.code(400).send({ error: 'invalid accountId' });
      }
      accountId = n;
    } else {
      accountId = await resolveAccountFromFilename(userId(req), filename);
    }
    if (!accountId) {
      return reply.code(400).send({
        error: 'cannot determine target account; pass ?accountId=N or configure a filename pattern',
      });
    }

    const uid = userId(req);

    if (format === 'pdf') {
      if (buffer.byteLength > PDF_MAX_BYTES) {
        return reply.code(413).send({ code: 'pdf_too_large', error: 'PDF exceeds 10MB limit' });
      }
      try {
        const r = await importPdf({ filename, accountId, userId: uid, buffer });
        if (r.kind === 'imported') {
          app.metrics.importsTotal.inc({ kind: 'pdf', outcome: 'success' });
          return reply.code(201).send(r);
        }
        // draft state — user needs to draw zones; neither success nor error.
        return reply.code(200).send(r);
      } catch (err: any) {
        app.metrics.importsTotal.inc({ kind: 'pdf', outcome: 'error' });
        if (err?.code === 'pdf_encrypted') return reply.code(400).send({ code: 'pdf_encrypted', error: 'PDF is password-protected' });
        if (err?.code === 'template_yielded_no_rows') {
          return reply.code(422).send({ code: 'template_yielded_no_rows', error: 'saved template did not match this PDF; retrain via /api/pdf-templates' });
        }
        app.log.error({ err, filename }, 'pdf import failed');
        return reply.code(400).send({ error: 'pdf import failed', message: err instanceof Error ? err.message : String(err) });
      }
    }

    try {
      const result = await runImport({ filename, accountId, userId: uid, format, buffer });
      app.metrics.importsTotal.inc({ kind: format, outcome: 'success' });
      return reply.code(201).send(result);
    } catch (err) {
      app.metrics.importsTotal.inc({ kind: format, outcome: 'error' });
      app.log.error({ err, filename }, 'import failed');
      return reply.code(400).send({ error: 'import failed', message: err instanceof Error ? err.message : String(err) });
    }
  });
```

**`POST /api/imports/photo`** — update the handler (currently lines 106-128) to increment on success and on the caught non-typed error:

```ts
  app.post('/api/imports/photo', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'no file uploaded' });
    const data = await req.file({ limits: { fileSize: 26 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });
    const filename = data.filename;
    const buffer = await data.toBuffer();
    const q = req.query as { accountId?: string };
    const accountId = q.accountId ? Number(q.accountId) : null;
    if (!accountId || !Number.isInteger(accountId) || accountId <= 0) {
      return reply.code(400).send({ error: 'invalid accountId' });
    }
    try {
      const result = await importPhoto({
        filename, accountId, userId: userId(req), buffer,
      });
      app.metrics.importsTotal.inc({ kind: 'photo', outcome: 'success' });
      return reply.code(200).send(result);
    } catch (err) {
      app.metrics.importsTotal.inc({ kind: 'photo', outcome: 'error' });
      if (err instanceof PhotoTooLargeError) return reply.code(400).send({ error: 'photo too large (max 25 MB)' });
      if (err instanceof PhotoUnsupportedMimeError) return reply.code(400).send({ error: err.message });
      app.log.error({ err, filename }, 'photo import failed');
      throw err;
    }
  });
```

**`POST /api/imports/pdf/templates`** — update the handler (currently lines 130-171). The success path is `reply.code(201).send(r)`, error paths are the catch block:

```ts
  app.post('/api/imports/pdf/templates', async (req, reply) => {
    const body = req.body as {
      draftId?: number;
      label?: string;
      zones?: TemplateZones;
      override_rows?: Array<{ date?: string; label?: string; amount?: string }>;
    };
    if (!body?.draftId || !body.label || !body.zones) {
      return reply.code(400).send({ error: 'draftId, label, and zones are required' });
    }
    let overrideRows: Array<{ date: string; label: string; amount: string }> | undefined;
    if (body.override_rows !== undefined) {
      if (!Array.isArray(body.override_rows)) {
        return reply.code(400).send({ error: 'override_rows must be an array' });
      }
      for (const r of body.override_rows) {
        if (
          typeof r?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
          typeof r?.label !== 'string' || r.label.length < 1 || r.label.length > 200 ||
          typeof r?.amount !== 'string' || !/^-?\d+([.,]\d{1,2})?$/.test(r.amount)
        ) {
          return reply.code(400).send({ error: 'invalid override_rows entry (expected date YYYY-MM-DD, label, decimal amount)' });
        }
      }
      overrideRows = body.override_rows as Array<{ date: string; label: string; amount: string }>;
    }
    try {
      const r = await applyTemplateAndImport({
        draftId: body.draftId,
        label: body.label,
        zones: body.zones,
        overrideRows,
        userId: userId(req),
      });
      app.metrics.importsTotal.inc({ kind: 'pdf', outcome: 'success' });
      return reply.code(201).send(r);
    } catch (err: any) {
      app.metrics.importsTotal.inc({ kind: 'pdf', outcome: 'error' });
      if (err?.code === 'draft_expired') return reply.code(410).send({ code: 'draft_expired', error: 'draft expired or not found' });
      if (err?.code === 'template_yielded_no_rows') return reply.code(422).send({ code: 'template_yielded_no_rows', error: 'zones produced 0 rows' });
      app.log.error({ err }, 'apply template failed');
      return reply.code(400).send({ error: 'apply template failed', message: err?.message ?? String(err) });
    }
  });
```

**Do NOT touch** the other handlers in that file (`GET /api/imports`, `GET /api/imports/:id`, `DELETE`, `PATCH`, draft-status endpoints, preview endpoint) — they're read/CRUD, not imports.

- [ ] **Step 5: Run tests to verify the CSV case passes**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: nine cases total PASS.

- [ ] **Step 6: Run the imports-route test to confirm no regression**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- imports-route
```

Expected: existing imports suite PASS (metric increment is a no-op side effect).

- [ ] **Step 7: Run full suite**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test
```

Expected: full suite PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/src/http/plugins/metrics.ts backend/src/http/routes/imports.ts backend/tests/metrics-endpoint.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(metrics): athena_imports_total counter + wire increments in imports routes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Sweeper aborted counter — plumb callback into `draft-sweeper.ts`

**Files:**
- Modify: `backend/src/domain/imports/pdf/draft-sweeper.ts` (accept `onAborted` callback)
- Modify: `backend/src/server.ts` (pass the callback from `startDraftSweeper` invocation)
- Modify: `backend/tests/metrics-endpoint.test.ts` (add one case)

**Interfaces:**
- Consumes: `app.metrics.importsTotal` (already exists after Task 4).
- Produces:
  - `sweepExpiredDrafts(onAborted?: (count: number) => void): Promise<number>` — invokes the callback once with the number of deleted drafts, only when count > 0. Return value unchanged.
  - `startDraftSweeper(app: FastifyInstance)` now wires the callback so each sweep that deletes N drafts calls `app.metrics.importsTotal.inc({kind:'pdf', outcome:'aborted'}, N)`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/metrics-endpoint.test.ts`. The sweeper's public surface is the exported `sweepExpiredDrafts` function; we call it directly with our own callback, and insert a soon-to-be-expired draft first.

```ts
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
```

**Test rationale**: we test two things at once — (1) `sweepExpiredDrafts` calls the callback with the right count, (2) the counter under that label increments correctly. We don't test that `startDraftSweeper` fires on schedule (that's a timer test we don't want to write). The second assertion (calling `.inc` explicitly) exercises the exact path `startDraftSweeper` will use.

- [ ] **Step 2: Run to verify the test fails**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: the new case FAILS — `sweepExpiredDrafts` doesn't accept a callback (TypeScript compile error, or at runtime `observed` stays at `-1`).

- [ ] **Step 3: Update `draft-sweeper.ts` to accept the callback**

Replace the contents of `backend/src/domain/imports/pdf/draft-sweeper.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { lt } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { pdfImportDrafts } from '../../../db/schema.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export async function sweepExpiredDrafts(
  onAborted?: (count: number) => void,
): Promise<number> {
  const deleted = await db
    .delete(pdfImportDrafts)
    .where(lt(pdfImportDrafts.expiresAt, new Date()))
    .returning({ id: pdfImportDrafts.id });
  const n = deleted.length;
  if (n > 0 && onAborted) onAborted(n);
  return n;
}

export function startDraftSweeper(app: FastifyInstance): void {
  const bumpMetric = (n: number) => {
    // app.metrics is decorated by metricsPlugin. In tests / degraded startup
    // where the plugin didn't register (e.g. build failure earlier in the
    // chain), fall back silently.
    if ((app as { metrics?: { importsTotal?: { inc: (l: { kind: string; outcome: string }, v: number) => void } } }).metrics?.importsTotal) {
      app.metrics.importsTotal.inc({ kind: 'pdf', outcome: 'aborted' }, n);
    }
  };
  void sweepExpiredDrafts(bumpMetric).catch((err) => app.log.error({ err }, 'pdf draft sweep failed'));
  const handle = setInterval(() => {
    void sweepExpiredDrafts(bumpMetric).catch((err) => app.log.error({ err }, 'pdf draft sweep failed'));
  }, SWEEP_INTERVAL_MS);
  handle.unref();
  app.addHook('onClose', async () => clearInterval(handle));
}
```

**No change** to `backend/src/server.ts` — `startDraftSweeper(app)` already receives `app` and now wires `bumpMetric` internally.

- [ ] **Step 4: Run the metrics test**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: ten cases total PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test
```

Expected: full suite PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/src/domain/imports/pdf/draft-sweeper.ts backend/tests/metrics-endpoint.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(metrics): count aborted PDF drafts swept by the sweeper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Backup last-success timestamp — hook-side

**Files:**
- Modify: `backend/src/http/plugins/metrics.ts` (declare gauge + extend hook)
- Modify: `backend/tests/metrics-endpoint.test.ts` (add one case)

**Interfaces:**
- Consumes: the existing `onResponse` hook + `app.metrics`.
- Produces:
  - `app.metrics.backupLastSuccessTimestampSeconds: Gauge` — Unix seconds; updated inside the existing `onResponse` hook when the responded-to route is `/api/backup/export` with `statusCode < 400`.

**Design rationale**: we already have an `onResponse` hook that runs after Fastify has finished serializing/sending the response. Adding one more condition to it (rather than wiring a second hook or touching `backup/export.ts`) keeps side effects centralized in `metrics.ts` and leaves the backup route untouched.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/metrics-endpoint.test.ts`. Reuse the cookie/account setup from earlier tests — cookies persist across `beforeAll` state within this file. Use a fresh login block here since Vitest doesn't guarantee ordering unless explicit:

```ts
  it('records athena_backup_last_success_timestamp_seconds after GET /api/backup/export', async () => {
    // Log in (reusing the metrics-user created earlier, or creating one if the
    // test order changed).
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'backup-user', password: 'backup-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'backup-user', password: 'backup-1234' },
    });
    // onboarding-create returns 409 if the user exists; login should still work.
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
    // Timestamp should be within 30 seconds of "now" — recorded during this test.
    expect(Number(m![1])).toBeGreaterThanOrEqual(nowBefore);
    expect(Number(m![1])).toBeLessThanOrEqual(nowBefore + 30);
  });
```

- [ ] **Step 2: Run to verify the test fails**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: the new case FAILS — gauge doesn't exist yet.

- [ ] **Step 3: Extend the plugin — declare gauge and extend the hook**

Edit `backend/src/http/plugins/metrics.ts`.

Update the `MetricsBag` interface — add:

```ts
  backupLastSuccessTimestampSeconds: Gauge<string>;
```

Add the gauge declaration alongside the others (before `app.decorate`):

```ts
  const backupLastSuccessTimestampSeconds = new Gauge({
    name: 'athena_backup_last_success_timestamp_seconds',
    help: 'Unix timestamp of the last successful GET /api/backup/export response.',
    registers: [registry],
  });
```

Update `app.decorate('metrics', {...})` to include it:

```ts
  app.decorate('metrics', {
    httpRequestsTotal,
    httpRequestDurationSeconds,
    dbSizeBytes,
    transactionsTotal,
    accountsTotal,
    importsTotal,
    backupLastSuccessTimestampSeconds,
  } as MetricsBag);
```

Extend the existing `onResponse` hook — add the backup-timestamp branch **after** the HTTP metrics increments but **before** the hook returns. Replace the current hook with:

```ts
  app.addHook('onResponse', async (req, reply) => {
    const url = req.routeOptions?.url ?? 'unmatched';
    if (url === '/metrics' || url === '/health') return;
    const method = req.method;
    const klass = statusClass(reply.statusCode);
    httpRequestsTotal.inc({ method, route: url, status_class: klass });
    httpRequestDurationSeconds.observe(
      { method, route: url, status_class: klass },
      reply.elapsedTime / 1000,
    );
    if (url === '/api/backup/export' && reply.statusCode < 400) {
      backupLastSuccessTimestampSeconds.setToCurrentTime();
    }
  });
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: eleven cases total PASS.

- [ ] **Step 5: Full suite**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test
```

Expected: full suite PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/src/http/plugins/metrics.ts backend/tests/metrics-endpoint.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(metrics): record last-success timestamp for /api/backup/export

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Public-safe assertion + rate-limit test + README docs

**Files:**
- Modify: `backend/tests/metrics-endpoint.test.ts` (two final cases)
- Modify: `README.md` (add Prometheus section)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: no new interface. Locks in the public-safe contract and the rate-limit config via tests. Adds a short doc block for operators.

- [ ] **Step 1: Write the two failing tests**

Append to `backend/tests/metrics-endpoint.test.ts`:

```ts
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
      /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email-shaped
      /\b\d{2}:\d{2}:\d{2}\b/,          // HH:MM:SS
    ];
    for (const pat of suspiciousPatterns) {
      expect(res.body).not.toMatch(pat);
    }
  });

  it('rate-limits /metrics past 20 req/min', async () => {
    // Fire 21 requests quickly; the 21st should be 429.
    const responses = [];
    for (let i = 0; i < 21; i++) {
      responses.push(
        await app.inject({
          method: 'GET', url: '/metrics',
          headers: { 'x-forwarded-for': '203.0.113.99' }, // stable synthetic IP
        }),
      );
    }
    const last = responses[responses.length - 1]!;
    expect(last.statusCode).toBe(429);
  });
```

**Note on the rate-limit test**: `@fastify/rate-limit` keys on the client IP (`req.ip`). `app.inject` runs in-process — the request IP defaults to `127.0.0.1`, and other tests in the file also hit `127.0.0.1`. To keep this test's counter independent, we set `x-forwarded-for`. If `trustProxy` is not enabled on Fastify (the default), the plugin still falls back to `req.ip`, so the 21-in-a-row burst may share the counter with earlier calls. If the test starts flaking on that ground, switch to firing 25 (max + 5) instead of 21 — the intent is "past the limit fails", not exact counting.

- [ ] **Step 2: Run to verify the tests fail (or already pass)**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected outcomes:
- Public-safe test likely **PASSES already** (regexes shouldn't match — labels are curated). If it fails, an accidental PII leak snuck in; fix it before continuing.
- Rate-limit test **FAILS** or **PASSES** depending on whether earlier tests exhausted the same IP's counter. Either way, if it fails once, bump the burst count to 25 as noted.

- [ ] **Step 3: Fix any surprise in the public-safe assertion**

If the public-safe test fails, inspect the offending line in the metrics output and remove the source. Do NOT relax the regex.

- [ ] **Step 4: Add README section for operators**

Edit `README.md` at the repo root. Find an "Operations" or "Deployment" section, or append a new section near the end. Add:

```markdown
## Metrics (Prometheus)

The backend exposes Prometheus metrics at `GET /metrics` on the same port
as the API. There is no authentication — the endpoint is designed for a
LAN-only deployment. Rate-limited to 20 requests per minute per client IP;
Prometheus normal scrape is 2–4 requests per minute.

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: athena
    metrics_path: /metrics
    scrape_interval: 30s
    static_configs:
      - targets: ['<homelab-host>:<port>']
```

Metrics of interest:

- `athena_http_requests_total{method,route,status_class}` — request counts.
- `athena_http_request_duration_seconds` — latency histogram.
- `athena_imports_total{kind,outcome}` — imports counted by format
  (`csv`/`ofx`/`qfx`/`pdf`/`photo`) and result (`success`/`error`/`aborted`).
- `athena_db_size_bytes` — Postgres database size.
- `athena_transactions_total`, `athena_accounts_total` — row counts.
- `athena_backup_last_success_timestamp_seconds` — Unix timestamp of the
  last successful `GET /api/backup/export`. Alert on `time() - <this> > <N days>`.
- `process_*`, `nodejs_*` — Node.js runtime metrics (from `prom-client`
  defaults): CPU, memory, event-loop lag, GC.
```

- [ ] **Step 5: Run tests one more time**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test -- metrics-endpoint
```

Expected: thirteen cases PASS.

- [ ] **Step 6: Full suite + build check**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
RUN_DB_TESTS=1 npm test && npm run build
```

Expected: tests PASS, TypeScript build PASS, no leftover diagnostics.

- [ ] **Step 7: Commit**

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting
git add backend/tests/metrics-endpoint.test.ts README.md
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "$(cat <<'EOF'
docs(metrics): README section + public-safe + rate-limit tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Final verification — inspect the running output**

Start the dev server manually (optional, LAN-safe smoke test):

```bash
cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/backend
npm run dev &
sleep 3
curl -s http://127.0.0.1:$(node -e "console.log(process.env.PORT || 3001)")/metrics | head -40
kill %1
```

Expected: text output starting with `# HELP process_cpu_seconds_total …` and containing several `athena_*` lines. If the port env var name differs, check `backend/src/env.ts`. This step is verification only — no code change.

---

## Notes on execution

- Do NOT push to origin — the project convention is main-only, local, push when explicitly asked.
- If the DB isn't running (OrbStack down, per memory), tests requiring `RUN_DB_TESTS=1` won't work. Do NOT start container runtimes. Instead, run only the type-check pass (`npm run build`) as a sanity gate, and defer the live test run until the DB is up.
- All commits use the Gekkotron identity via `-c user.name=… -c user.email=…`. Do not modify `.git/config`.
