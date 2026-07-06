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

// Second-pass parent-linking for the category tree. First pass inserts every
// category flat (parent=null). This pass returns the update batch that wires
// parent references, computed purely from the dump's natural keys plus the
// name→id map the first pass produced.
//
// Categories whose parent name is missing (self-orphans, references to
// categories that failed to insert) are silently skipped — the parent stays
// null. That's intentional: a category with a broken parent is still a
// usable category, just top-level.
export function planCategoryParentLinks(
  dumpCategories: BackupDump['categories'],
  idByName: Map<string, number>,
): Array<{ childId: number; parentId: number }> {
  const links: Array<{ childId: number; parentId: number }> = [];
  for (const c of dumpCategories) {
    if (!c.parent) continue;
    const childId = idByName.get(c.name);
    const parentId = idByName.get(c.parent);
    if (childId && parentId) {
      links.push({ childId, parentId });
    }
  }
  return links;
}
