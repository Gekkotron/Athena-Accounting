# Prometheus `/metrics` endpoint — design

**Date**: 2026-07-15
**Status**: spec — pending implementation plan
**Scope**: backend only

## Motivation

The project runs on a Geekom mini-PC homelab with a self-hosted Grafana. Today there is zero server-side observability beyond Fastify's request log. We want a Prometheus-compatible `/metrics` endpoint so Grafana can graph request latency, error rate, import volume, DB growth, and backup freshness without cloud dependencies.

## Non-goals

- Distributed tracing (OpenTelemetry).
- Per-user metrics (would break the public-safe contract — no user IDs in labels).
- Server-side alerting (Grafana/Alertmanager owns that).
- A reset endpoint for counters (they live for the process lifetime — acceptable).
- Metric persistence across restarts (Prometheus scrape storage handles it).
- A shipped Grafana dashboard (the user builds their own).

## Constraints

- **Public-safe**: no PII, no IDs, no hostnames, no IPs in any label — the codebase is going public and metrics text is inspectable.
- **LAN-only deployment**: `/metrics` is exposed without authentication, on the same principle as `/health`.
- **Fastify + fastify-plugin conventions** already used by `authPlugin`.
- **No new backend services or sidecars** — must live inside the existing Fastify process.

## Architecture

A single new plugin file: `backend/src/http/plugins/metrics.ts`, wrapped with `fastify-plugin`. Responsibilities:

1. Instantiate a `prom-client` `Registry` and enable `collectDefaultMetrics()` for free Node.js runtime metrics.
2. Declare custom metrics (see Catalog) and decorate them on `app.metrics` so route handlers can increment them (`app.metrics.importsTotal.inc(...)`).
3. Register an `onResponse` hook that records `athena_http_requests_total` and `athena_http_request_duration_seconds`.
4. Register `GET /metrics` that emits `register.metrics()` with `text/plain; version=0.0.4; charset=utf-8`.

Wiring in `server.ts` (order matters — `metricsPlugin` sits **after** `rateLimit` so `config.rateLimit` on `GET /metrics` actually applies, and **before** `authPlugin` so `/metrics` inherits no session while the `onResponse` hook still sees all business routes registered afterwards):

```
app.get('/health', …);
await app.register(multipart);
await app.register(rateLimit, …);
await app.register(metricsPlugin);   // NEW — after rateLimit, before authPlugin
await app.register(authPlugin);
// … business routes
```

`/health` is registered before `metricsPlugin` and therefore stays outside the `onResponse` hook's scope — a natural exclusion. The `if (url === '/health') return;` guard inside the hook is kept as a defensive belt-and-braces, so a future refactor that moves `/health` after `metricsPlugin` still won't pollute the HTTP metrics.

## New dependency

- `prom-client` (latest stable). ~350 KB in `node_modules`, zero transitive weight, standard Node.js Prometheus library.

## Metrics catalog

### Runtime (free from `collectDefaultMetrics`)

`process_cpu_seconds_total`, `process_resident_memory_bytes`, `nodejs_eventloop_lag_seconds`, `nodejs_gc_duration_seconds`, `nodejs_heap_size_used_bytes`, and the rest of the prom-client default set.

### Custom (`athena_` prefix)

| Name | Type | Labels | Description |
|---|---|---|---|
| `athena_http_requests_total` | Counter | `method`, `route`, `status_class` | Count of HTTP requests. `status_class` ∈ `{2xx, 3xx, 4xx, 5xx}`. `route` = Fastify route template (`/api/accounts/:id`), never the raw URL. Unmatched routes labeled `route="unmatched"`. |
| `athena_http_request_duration_seconds` | Histogram | `method`, `route`, `status_class` | HTTP latency in seconds. Buckets: prom-client defaults `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`. |
| `athena_imports_total` | Counter | `kind`, `outcome` | `kind` ∈ `{csv, pdf}`, `outcome` ∈ `{success, error, aborted}`. `aborted` covers PDF drafts expired by the sweeper. |
| `athena_transactions_total` | Gauge | — | Count of non-deleted transactions. Refreshed on scrape via `collect()`. |
| `athena_accounts_total` | Gauge | — | Count of non-archived accounts. Refreshed on scrape. |
| `athena_db_size_bytes` | Gauge | — | `pg_database_size(current_database())`. Refreshed on scrape. |
| `athena_backup_last_success_timestamp_seconds` | Gauge | — | Unix timestamp of the last successful `GET /api/backup/export` (stream finished without error). Enables "no backup for X days" alerts. |

**Cardinality budget**: ~30 routes × 5 methods × 4 status_class ≈ 600 series max on the HTTP counter/histogram. Comfortable.

**Public-safe contract**: the only labels are `method`, `route`, `status_class`, `kind`, `outcome`. No dynamic user-controlled values. This is verified by an automated test (see Testing).

## HTTP hook

```
app.addHook('onResponse', async (req, reply) => {
  const url = req.routeOptions?.url ?? 'unmatched';
  if (url === '/metrics' || url === '/health') return;
  const method = req.method;
  const statusClass = `${Math.floor(reply.statusCode / 100)}xx`;
  const durSeconds = reply.elapsedTime / 1000;
  app.metrics.httpRequestsTotal.inc({ method, route: url, status_class: statusClass });
  app.metrics.httpRequestDurationSeconds.observe(
    { method, route: url, status_class: statusClass },
    durSeconds,
  );
});
```

- Excludes `/metrics` (self-scrape noise) and `/health` (constant load-balancer bruit).
- Uses Fastify's `reply.elapsedTime` (ms) — no manual `process.hrtime` bookkeeping.
- Uses `req.routeOptions?.url` (route template) not `req.url` (raw path with params) to bound cardinality.

## Scrape-time gauges (collect pattern)

Instead of a `setInterval`, gauges use prom-client's async `collect()` — the query runs only when Prometheus scrapes (~every 15-30s).

```
new Gauge({
  name: 'athena_db_size_bytes',
  help: '…',
  registers: [registry],
  async collect() {
    const { rows } = await pool.query(
      "SELECT pg_database_size(current_database())::bigint AS s"
    );
    this.set(Number(rows[0].s));
  },
});
```

Same pattern for `athena_transactions_total` (`SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL`) and `athena_accounts_total` (`SELECT COUNT(*) FROM accounts WHERE archived_at IS NULL` — exact predicate to be confirmed against the current schema in the implementation plan).

**Error handling in `collect()`**: if the query throws (e.g., Postgres down), catch the error, log `app.log.warn`, and let the gauge keep its last value. The scrape itself must not return 500 — other metrics still ship.

## Manual increment sites

| Metric | Where | Timing |
|---|---|---|
| `athena_imports_total{kind:'csv', outcome:'success'}` | CSV import route | After DB commit, before `reply.send`. |
| `athena_imports_total{kind:'pdf', outcome:'success'}` | PDF finalize route | After DB commit. |
| `athena_imports_total{outcome:'error'}` | Both routes | In explicit error branches (parse fail, DB constraint). |
| `athena_imports_total{kind:'pdf', outcome:'aborted'}` | `startDraftSweeper` | When a draft expires. |
| `athena_backup_last_success_timestamp_seconds.setToCurrentTime()` | `backup/export.ts` | After the response stream emits `finish` without error. |

The plan will pin the exact call sites once the current route/domain layout is walked.

## `/metrics` route

```
app.get('/metrics', {
  config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
}, async (_req, reply) => {
  reply.header('Content-Type', register.contentType);
  return register.metrics();
});
```

- **Rate-limit**: 20 req/min per IP. Prometheus normal scrape is 2-4 req/min (`scrape_interval: 15-30s`), so plenty of headroom. Blocks curl-loop abuse.
- **No auth**: matches `/health`. LAN-only deployment assumed.
- **Content-Type**: `register.contentType` from prom-client (`text/plain; version=0.0.4; charset=utf-8`).

## Testing

New file: `backend/tests/metrics-endpoint.test.ts`, following the pattern of `reports-route.test.ts`. Uses the same Postgres test DB harness (`scripts/test-db.sh`).

Cases:

1. `GET /metrics` returns 200 with `Content-Type: text/plain; version=0.0.4; charset=utf-8`, body contains `# HELP athena_http_requests_total` and matching `# TYPE …` lines.
2. `/metrics` responds 200 without a session cookie (unauth path confirmed).
3. HTTP hook excludes `/metrics` and `/health` — after `app.inject({ url: '/health' })`, the response body contains no `athena_http_requests_total{…,route="/health"}` line. Same for `/metrics`.
4. Counter increments — a request to `/api/accounts` produces `athena_http_requests_total{method="GET",route="/api/accounts",status_class="2xx"} 1`.
5. Histogram observes — same request produces `athena_http_request_duration_seconds_bucket{le="+Inf",…} 1` and `_count{…} 1`.
6. Unmatched routes labeled `route="unmatched"` — GET on `/api/does-not-exist` shows in that bucket.
7. `athena_imports_total` increments after a mocked successful CSV import (`kind="csv",outcome="success"` goes from 0 to 1).
8. `athena_db_size_bytes` collected at scrape time (`pg_database_size` query fires; value ≥ 0).
9. **Public-safe assertion**: regex `/user_id|account_id|transaction_id|@|[0-9]{2}:[0-9]{2}:[0-9]{2}/` on the response body returns 0 matches.
10. Rate-limit: 25 rapid requests from the same IP → the 21st returns 429.

Not tested (upstream lib territory or non-deterministic):

- Runtime Node metrics from `prom-client` defaults.
- Exact numeric gauge values (depend on test DB state; only `>= 0` is asserted).
- Hook performance.

## Documentation

Add a short section to the backend README explaining Prometheus scrape config:

```
scrape_configs:
  - job_name: athena
    metrics_path: /metrics
    scrape_interval: 30s
    static_configs:
      - targets: ['<homelab-host>:<port>']
```

No shipped Grafana dashboard (out of scope).

## Rollout

Single PR (single-file feature + single test file + one line in `server.ts` + one line in `backend/package.json`). No migration, no data change. Landed directly on `main` per project convention.

## Open questions deferred to the implementation plan

- Exact predicate for `accounts_total` (verify column: `archived_at`, `deleted_at`, or another) against the current schema.
- Exact hook to detect "backup export stream finished successfully" in `backup/export.ts` (probably `reply.raw.on('finish')` after a non-error path, but the current handler shape decides).
- Whether `athena_imports_total{outcome:'error'}` should also fire from the OCR pipeline draft-sweeper's error branch, or only on user-facing import routes.
