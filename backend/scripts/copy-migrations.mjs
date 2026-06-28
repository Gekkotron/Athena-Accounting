// Copies *.sql files from src/db/migrations to dist/db/migrations after tsc.
// tsc compiles .ts only; the SQL files need to ride along so they're present
// at runtime in the Docker image.

import { readdir, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src/db/migrations');
const dst = path.resolve(here, '../dist/db/migrations');

await mkdir(dst, { recursive: true });
const files = await readdir(src);
for (const file of files) {
  if (file.endsWith('.sql')) {
    await copyFile(path.join(src, file), path.join(dst, file));
  }
}
console.log(`Copied ${files.filter(f => f.endsWith('.sql')).length} migration file(s) to dist/`);
