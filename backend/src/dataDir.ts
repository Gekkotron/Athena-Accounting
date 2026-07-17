import { existsSync } from 'node:fs';

// Returns the working directory for user-owned data (PGlite file, uploads,
// future backups). Resolution order:
//   1. `DATA_DIR` env — explicit override, wins in every environment.
//   2. `/data` when running inside a Docker container (detected via the
//      `/.dockerenv` marker file that Docker mounts into every container).
//      This matches the volume path baked into docker-compose.
//   3. `process.cwd()` — dev fallback, keeps PGlite files next to the repo
//      unless the developer opts in via DATA_DIR.
export function dataDir(): string {
  const fromEnv = process.env.DATA_DIR;
  if (fromEnv) return fromEnv;
  if (existsSync('/.dockerenv')) return '/data';
  return process.cwd();
}
