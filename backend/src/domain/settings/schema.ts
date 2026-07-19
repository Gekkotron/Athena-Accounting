import { z } from 'zod';
import { DEFAULTS } from './defaults.js';
import type { DashboardRange, DashboardChartScope } from './defaults.js';

export const SettingsSchema = z
  .object({
    dashboardRange: z.enum(['30d', '3m', '6m', '12m', 'all']).optional(),
    dashboardChartScope: z
      .union([z.literal('all'), z.number().int().positive()])
      .optional(),
    chartGapThresholdDays: z.number().int().min(1).max(60).optional(),
    duplicateSimilarityThreshold: z.number().int().min(0).max(100).optional(),
    showForecast: z.boolean().optional(),
  })
  .strict();

export type Settings = z.infer<typeof SettingsSchema>;

export type FullSettings = {
  dashboardRange: DashboardRange;
  dashboardChartScope: DashboardChartScope;
  chartGapThresholdDays: number;
  duplicateSimilarityThreshold: number;
  showForecast: boolean;
};

// Merges DEFAULTS <- stored (unvalidated JSONB) <- patch. `stored` is
// treated as untrusted input — unknown keys are dropped, invalid values
// fall back to their default. This is the last line of defense: even if
// something outside PATCH wrote garbage into the JSONB, GET returns a
// clean, complete shape.
export function mergeSettings(stored: unknown, patch: Partial<Settings> = {}): FullSettings {
  const safe: FullSettings = { ...DEFAULTS };
  const src = (stored && typeof stored === 'object') ? (stored as Record<string, unknown>) : {};
  const parsed = SettingsSchema.safeParse(src);
  if (parsed.success) Object.assign(safe, parsed.data);
  // patch has already been validated by the caller.
  Object.assign(safe, patch);
  return safe;
}
