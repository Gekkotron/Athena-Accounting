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
