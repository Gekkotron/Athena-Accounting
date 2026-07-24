import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client.js';
import { accounts } from '../../db/schema.js';
import { runImport } from './import-service.js';
import { importPdf } from './pdf/index.js';
import {
  candidateFormat,
  isCandidateFile,
  matchAccountFolder,
  outcomePath,
} from './watch-folder-core.js';

// Opt-in watch-folder importer: when WATCH_IMPORTS_DIR is set, statements
// dropped into `$WATCH_IMPORTS_DIR/<account name>/` run through the normal
// import pipeline (dedup, rules, transfer + recurring detection) and the
// file is renamed in place to record the outcome (.imported / .failed +
// .error.txt / .needs-template), which also makes re-polls idempotent.
//
// Polling, not fs.watch — inotify-style events are unreliable on the SMB/
// NFS shares this feature exists for.
const POLL_INTERVAL_MS = 60_000;

interface WatchLog {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface WatchScanResult {
  imported: number;
  failed: number;
  needsTemplate: number;
}

export async function scanWatchFolderOnce(dir: string, log: WatchLog): Promise<WatchScanResult> {
  const result: WatchScanResult = { imported: 0, failed: 0, needsTemplate: 0 };

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    log.error(`[watch-imports] cannot read ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const rootCandidates = entries.filter((e) => e.isFile() && isCandidateFile(e.name));
  if (rootCandidates.length > 0) {
    log.warn(
      `[watch-imports] ${rootCandidates.length} file(s) at the watch-folder root are ignored — ` +
      'drop statements into a subfolder named after the destination account',
    );
  }

  const subdirs = entries.filter((e) => e.isDirectory());
  if (subdirs.length === 0) return result;

  // userId is nullable in the schema for legacy pre-multi-user rows; an
  // ownerless account can't receive watched imports, so drop those.
  const accountRows = (
    await db
      .select({ id: accounts.id, userId: accounts.userId, name: accounts.name })
      .from(accounts)
  ).filter((a): a is { id: number; userId: number; name: string } => a.userId !== null);

  for (const sub of subdirs) {
    const subPath = join(dir, sub.name);
    let names: string[];
    try {
      names = await readdir(subPath);
    } catch {
      continue;
    }
    const candidates = names.filter(isCandidateFile).sort();
    if (candidates.length === 0) continue;

    const match = matchAccountFolder(sub.name, accountRows);
    if (match.kind !== 'ok') {
      // Never guess where money data lands — leave the files in place so
      // renaming the folder (or the account) later just works.
      log.warn(
        `[watch-imports] folder "${sub.name}" ` +
        (match.kind === 'collision'
          ? 'matches more than one account'
          : 'matches no account name') +
        ` — ${candidates.length} file(s) left untouched`,
      );
      continue;
    }

    for (const name of candidates) {
      const filePath = join(subPath, name);
      const format = candidateFormat(name)!;
      try {
        const buffer = await readFile(filePath);
        if (format === 'pdf') {
          const r = await importPdf({
            filename: name, accountId: match.accountId, userId: match.userId,
            buffer, headless: true,
          });
          if (r.kind === 'skipped') {
            await rename(filePath, outcomePath(filePath, 'needs-template'));
            result.needsTemplate++;
            log.warn(`[watch-imports] ${name}: no usable PDF template (${r.reason}) — train one via the import wizard, then re-drop the file`);
            continue;
          }
          if (r.kind !== 'imported') continue; // unreachable in headless mode
          log.info(`[watch-imports] ${name} → "${sub.name}": ${r.result.insertedCount} inserted, ${r.result.dedupSkipped} deduplicated`);
        } else {
          const r = await runImport({
            filename: name, accountId: match.accountId, userId: match.userId,
            format, buffer,
          });
          log.info(`[watch-imports] ${name} → "${sub.name}": ${r.insertedCount} inserted, ${r.dedupSkipped} deduplicated`);
        }
        await rename(filePath, outcomePath(filePath, 'imported'));
        result.imported++;
      } catch (err) {
        result.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[watch-imports] ${name} failed: ${msg}`);
        try {
          await writeFile(`${filePath}.error.txt`, `${msg}\n`);
          await rename(filePath, outcomePath(filePath, 'failed'));
        } catch {
          // Rename/write failed (e.g. share went read-only) — the next
          // scan will simply retry the file.
        }
      }
    }
  }
  return result;
}

export function startWatchFolder(app: FastifyInstance): void {
  const dir = process.env.WATCH_IMPORTS_DIR;
  if (!dir) return;
  app.log.info(`[watch-imports] watching ${dir} (every ${POLL_INTERVAL_MS / 1000}s)`);
  let running = false;
  const tick = (): void => {
    if (running) return; // a slow NAS scan must never overlap the next tick
    running = true;
    void scanWatchFolderOnce(dir, app.log)
      .catch((err) => app.log.error({ err }, '[watch-imports] scan failed'))
      .finally(() => { running = false; });
  };
  tick();
  const handle = setInterval(tick, POLL_INTERVAL_MS);
  handle.unref();
  app.addHook('onClose', async () => clearInterval(handle));
}
