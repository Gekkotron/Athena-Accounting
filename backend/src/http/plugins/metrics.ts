import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';
import { pool } from '../../db/client.js';

export interface MetricsBag {
  httpRequestsTotal: Counter<'method' | 'route' | 'status_class'>;
  httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status_class'>;
  dbSizeBytes: Gauge<string>;
  transactionsTotal: Gauge<string>;
  accountsTotal: Gauge<string>;
  importsTotal: Counter<'kind' | 'outcome'>;
  backupLastSuccessTimestampSeconds: Gauge<string>;
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

  const importsTotal = new Counter({
    name: 'athena_imports_total',
    help: 'Count of import attempts, labeled by kind (ofx|qfx|csv|pdf|photo) and outcome (success|error|aborted).',
    labelNames: ['kind', 'outcome'] as const,
    registers: [registry],
  });

  const backupLastSuccessTimestampSeconds = new Gauge({
    name: 'athena_backup_last_success_timestamp_seconds',
    help: 'Unix timestamp of the last successful GET /api/backup/export response.',
    registers: [registry],
  });

  app.decorate('metrics', {
    httpRequestsTotal,
    httpRequestDurationSeconds,
    dbSizeBytes,
    transactionsTotal,
    accountsTotal,
    importsTotal,
    backupLastSuccessTimestampSeconds,
  } as MetricsBag);

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

  app.get('/metrics', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
};

export const metricsPlugin = fp(plugin, { name: 'metrics' });
