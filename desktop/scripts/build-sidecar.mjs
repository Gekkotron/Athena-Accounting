#!/usr/bin/env node
// Builds a self-contained desktop/sidecar/ directory the Tauri shell can spawn.
//
// Layout produced:
//   desktop/sidecar/node                — bundled Node runtime for the target
//   desktop/sidecar/entry.js            — esbuild bundle of backend/src/entry/tauri.ts
//   desktop/sidecar/node_modules/       — externals Node resolves at runtime
//                                         (native addons + assets — see README)
//   desktop/sidecar/migrations/         — *.sql copied for runMigrations()
//   desktop/sidecar/prebuilds/          — standalone asset files (traineddata etc.)
//   desktop/sidecar/package.json        — declares { "type": "module" } for entry.js
//
// The "prebuilds/" name in PLAN.md is aspirational: native packages like sharp
// only resolve when placed under node_modules/, so the native-addon tree lives
// there. prebuilds/ carries the standalone asset files the app loads by path.
//
// Runs standalone on a dev host — no CI required. Cross-compiling for another
// OS/arch is the packaging workflow's job (see PLAN.md); this script defaults
// to the host platform.
//
// Usage:
//   node desktop/scripts/build-sidecar.mjs
//   NODE_TARGET=v22.11.0 TARGET_OS=darwin TARGET_ARCH=arm64 node desktop/scripts/build-sidecar.mjs

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const BACKEND = path.join(REPO, 'backend');
const SIDECAR = path.join(REPO, 'desktop', 'sidecar');
const CACHE = path.join(REPO, 'desktop', '.node-cache');

const NODE_VERSION = process.env.NODE_TARGET ?? 'v22.11.0';
const TARGET_OS = process.env.TARGET_OS ?? process.platform; // darwin | linux | win32
const TARGET_ARCH = process.env.TARGET_ARCH ?? process.arch; // arm64 | x64

const log = (msg) => console.log(`[build-sidecar] ${msg}`);

function run(cmd, args, opts = {}) {
  // On Windows, npm/curl are shipped as .cmd/.exe launchers; spawn without a
  // shell won't resolve them via PATHEXT. Enabling shell mode is enough — args
  // are still passed as an array, so we don't reintroduce quoting hazards.
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`);
  }
}

// --- 1. Prepare sidecar dir ---------------------------------------------

log(`target = ${TARGET_OS}-${TARGET_ARCH}, node = ${NODE_VERSION}`);
if (existsSync(SIDECAR)) rmSync(SIDECAR, { recursive: true, force: true });
mkdirSync(SIDECAR, { recursive: true });
mkdirSync(CACHE, { recursive: true });

// --- 2. Fetch the Node binary for the target ----------------------------

function nodeArchiveName() {
  if (TARGET_OS === 'win32') return `node-${NODE_VERSION}-win-${TARGET_ARCH}.zip`;
  const os = TARGET_OS === 'darwin' ? 'darwin' : 'linux';
  return `node-${NODE_VERSION}-${os}-${TARGET_ARCH}.tar.xz`;
}

function nodeDownloadUrl(archive) {
  // Official distribution covers common desktop arches. If a future exotic
  // target isn't there, swap the base URL for https://unofficial-builds.nodejs.org/download/release
  return `https://nodejs.org/dist/${NODE_VERSION}/${archive}`;
}

function downloadNode() {
  const archive = nodeArchiveName();
  const cached = path.join(CACHE, archive);
  if (!existsSync(cached)) {
    const url = nodeDownloadUrl(archive);
    log(`downloading ${url}`);
    run('curl', ['-fsSL', '-o', cached, url]);
  } else {
    log(`node archive cached: ${cached}`);
  }
  return cached;
}

function extractNode(archivePath) {
  const workdir = path.join(CACHE, `${path.basename(archivePath)}.extracted`);
  if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
  // GitHub Actions' windows-latest ships a bsdtar that transparently extracts
  // .zip archives, so a single `tar -xf` covers all three platforms.
  run('tar', ['-xf', archivePath, '-C', workdir]);
  const [top] = readdirSync(workdir);
  const src =
    TARGET_OS === 'win32'
      ? path.join(workdir, top, 'node.exe')
      : path.join(workdir, top, 'bin', 'node');
  const dst = path.join(SIDECAR, TARGET_OS === 'win32' ? 'node.exe' : 'node');
  cpSync(src, dst);
  chmodSync(dst, 0o755);
  log(`node binary → ${path.relative(REPO, dst)}`);
}

extractNode(downloadNode());

// --- 3. Install runtime deps into desktop/sidecar/node_modules ----------

const backendPkg = JSON.parse(readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
const runtimeDeps = backendPkg.dependencies;

const sidecarPkg = {
  name: 'athena-sidecar',
  private: true,
  version: backendPkg.version,
  type: 'module',
  dependencies: runtimeDeps,
};
writeFileSync(path.join(SIDECAR, 'package.json'), JSON.stringify(sidecarPkg, null, 2));

log('installing runtime deps (npm install --omit=dev, no lockfile) …');
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], {
  cwd: SIDECAR,
});

// --- 4. esbuild the entry ----------------------------------------------

const externals = Object.keys(runtimeDeps);
log(`esbuild entry.js (externals: ${externals.length} packages)`);

const esbuild = path.join(BACKEND, 'node_modules', '.bin', 'esbuild');
run(esbuild, [
  path.join(BACKEND, 'src', 'entry', 'tauri.ts'),
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--target=node22',
  '--sourcemap',
  `--outfile=${path.join(SIDECAR, 'entry.js')}`,
  // Fastify + friends do runtime `require('foo')` on CJS deps. In ESM output
  // esbuild polyfills `require`; make sure any bare specifier stays external
  // so the sidecar's node_modules/ resolves it at runtime.
  ...externals.map((d) => `--external:${d}`),
  // The tsx dev runner and Node's ESM loader see .js imports in .ts sources.
  '--loader:.node=file',
]);

// --- 5. Copy migrations ------------------------------------------------
// runMigrations() resolves ./migrations relative to import.meta.url of
// migrate.js. In the bundle, that URL is desktop/sidecar/entry.js, so the
// resolver looks at desktop/sidecar/migrations/. Copy them there.

const migSrc = path.join(BACKEND, 'src', 'db', 'migrations');
const migDst = path.join(SIDECAR, 'migrations');
mkdirSync(migDst, { recursive: true });
for (const f of readdirSync(migSrc)) {
  if (f.endsWith('.sql')) cpSync(path.join(migSrc, f), path.join(migDst, f));
}
log(`migrations → ${path.relative(REPO, migDst)} (${readdirSync(migDst).length} files)`);

// --- 6. prebuilds/ — standalone asset files ----------------------------
// The native addons live under node_modules/ (see step 3). This directory is
// for asset files the app loads by explicit path — currently reserved for
// tesseract .traineddata packs. The plan mentions PGlite .wasm and pdfjs
// worker; both are resolved via their own package (pglite loads its wasm
// via new URL(..., import.meta.url); pdfjs worker is resolved by its
// package.json exports), so they don't need to be copied here — the packages
// are present in node_modules/.

const prebuilds = path.join(SIDECAR, 'prebuilds');
mkdirSync(prebuilds, { recursive: true });

const traineddata = ['eng.traineddata', 'fra.traineddata'];
for (const t of traineddata) {
  const src = path.join(REPO, t);
  if (existsSync(src)) {
    cpSync(src, path.join(prebuilds, t));
  }
}

// --- 7. Summary --------------------------------------------------------

log('done. To smoke-test:');
log(`  ./desktop/sidecar/node ./desktop/sidecar/entry.js`);
log('  (expect: ATHENA_PORT=<n> on stdout; curl 127.0.0.1:<n>/health → {ok:true})');
