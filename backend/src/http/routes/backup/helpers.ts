import type { BackupDump } from './schema.js';

// Natural-key resolvers and pure planning helpers for the restore path.
// These are the pieces that make the id-remap testable without a live DB —
// the actual inserts/updates in restore.ts pass their output straight into
// Drizzle calls.

// Look up an id from a natural-key map. Returns null when the name is
// missing, undefined, or unknown. Small helper, but centralising it removes
// the `x.get(name) ?? null` scatter and gives us one place to change the
// unknown-name policy if we ever need to.
export function resolveNameToId(
  name: string | null | undefined,
  map: Map<string, number>,
): number | null {
  if (name == null) return null;
  return map.get(name) ?? null;
}

// Old backups may carry kind='transfer'; the app dropped that value in
// migration 0010. Coerce on restore so historical dumps still round-trip.
export type NormalizedCategoryKind = 'expense' | 'income' | 'neutral';

export function normalizeCategoryKind(
  kind: BackupDump['categories'][number]['kind'],
): NormalizedCategoryKind {
  return kind === 'transfer' ? 'neutral' : kind;
}

// Resolve a downstream category reference from a restored dump.
//   - v4 dumps carry (name, categoryParent) → look up by path.
//   - v3 and older dumps carry only (name) → fall back to name-only,
//     preferring the top-level match when the leaf name is ambiguous.
export function resolveCategoryRef(
  name: string | null | undefined,
  parentName: string | null | undefined,
  byPath: Map<string, number>,
  idsByName: Map<string, number[]>,
): number | null {
  if (name == null) return null;
  if (parentName !== undefined) {
    // v4 signal is present (even if parentName is null → root); prefer path lookup.
    const key = `${parentName ?? ''}::${name}`;
    const hit = byPath.get(key);
    if (hit != null) return hit;
    // Path miss on a v4 dump: fall through to name lookup as a last resort.
  }
  const candidates = idsByName.get(name) ?? [];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  // Ambiguous: prefer a top-level candidate (byPath key `::name`).
  const topLevel = byPath.get(`::${name}`);
  if (topLevel != null && candidates.includes(topLevel)) return topLevel;
  // No top-level, none preferred: deterministic first-inserted.
  return candidates[0]!;
}
