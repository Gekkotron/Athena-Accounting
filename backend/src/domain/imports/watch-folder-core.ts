// Pure decision logic for the watch-folder importer — file classification,
// account-folder matching, and outcome renaming — kept dependency-free
// (importing import-service.js would drag in db/client.js and its env
// checks) so it unit-tests in isolation.

export type WatchFormat = 'ofx' | 'csv' | 'pdf';
export type WatchOutcome = 'imported' | 'failed' | 'needs-template';
const OUTCOME_SUFFIXES = ['.imported', '.failed', '.needs-template', '.error.txt'];

// Extension map kept in lock-step with inferFormat in import-service.ts.
export function candidateFormat(name: string): WatchFormat | null {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'ofx' || ext === 'qfx') return 'ofx';
  if (ext === 'csv') return 'csv';
  if (ext === 'pdf') return 'pdf';
  return null;
}

export function isCandidateFile(name: string): boolean {
  if (name.startsWith('.')) return false;
  const lower = name.toLowerCase();
  if (OUTCOME_SUFFIXES.some((s) => lower.endsWith(s))) return false;
  return candidateFormat(name) !== null;
}

// Accent- and case-insensitive folder → account match. NFD strips the
// combining marks so "Épargne Éloïse" and "epargne eloise" meet in the
// middle.
function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export type AccountMatch =
  | { kind: 'ok'; accountId: number; userId: number }
  | { kind: 'unmatched' }
  | { kind: 'collision' };

// A collision (two accounts normalizing to the same name, same user or
// not) is reported rather than resolved — the watcher must never guess
// where money data lands.
export function matchAccountFolder(
  folder: string,
  accounts: ReadonlyArray<{ id: number; userId: number; name: string }>,
): AccountMatch {
  const needle = normalizeName(folder);
  const hits = accounts.filter((a) => normalizeName(a.name) === needle);
  if (hits.length === 0) return { kind: 'unmatched' };
  if (hits.length > 1) return { kind: 'collision' };
  return { kind: 'ok', accountId: hits[0]!.id, userId: hits[0]!.userId };
}

export function outcomePath(filePath: string, outcome: WatchOutcome): string {
  return `${filePath}.${outcome}`;
}
