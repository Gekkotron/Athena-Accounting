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
