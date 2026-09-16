import { Counter, type Registry } from 'prom-client';

// Domain-level notification hooks silently swallowed every failure through
// a bare console.error. This module-level Counter is bumped instead so the
// scrape target actually reports the degradation, while the Fastify metrics
// plugin adds it to its private registry via attachHookMetrics(). Kept
// registry-less at construction so unit tests can inspect it without
// booting Fastify.
export const notificationHookFailuresTotal = new Counter({
  name: 'athena_notification_hook_failures_total',
  help: 'Count of notification hook failures, labeled by hook name.',
  labelNames: ['hook'] as const,
  registers: [],
});

export function attachHookMetrics(registry: Registry): void {
  registry.registerMetric(notificationHookFailuresTotal);
}
