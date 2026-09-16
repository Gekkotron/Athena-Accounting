// Insight types split out so insight-builders.ts can import them without
// touching insights.ts (which itself imports from insight-builders → the
// two files would otherwise form a cycle).
export type InsightTone = 'sage' | 'clay' | 'neutral';
export type InsightLang = 'en' | 'fr';

export interface Insight {
  key: string;
  icon: string;
  headline: string;
  detail: string | null;
  tone: InsightTone;
  score: number;
  spark?: number[];
  // In-app route this insight deep-links to. Rendered as a Link when set.
  to?: string;
}
