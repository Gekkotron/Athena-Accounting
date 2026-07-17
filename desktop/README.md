# Athena Desktop

Tauri distribution of Athena — a self-contained window that spawns the same
Fastify backend used by the Docker path, serving the built frontend over
loopback. Two moving parts:

1. **`sidecar/`** — the backend as a directory the Tauri shell spawns.
2. **`src-tauri/`** — the Rust shell (added by the next task in `PLAN.md`).

This README documents the sidecar layout so the packaging workflow knows
what to bundle per platform.

## Building the sidecar (host platform)

```bash
node desktop/scripts/build-sidecar.mjs
```

Produces `desktop/sidecar/` from a clean checkout. Requires a working
`npm`, `curl`, and (on non-Windows) `tar`. Cross-compiling to a different
OS/arch is the packaging workflow's job — this script defaults to the host.

Overrides (used by CI, not typically needed locally):

```bash
NODE_TARGET=v22.11.0 \
TARGET_OS=darwin TARGET_ARCH=arm64 \
  node desktop/scripts/build-sidecar.mjs
```

Valid `TARGET_OS`: `darwin`, `linux`, `win32`. Valid `TARGET_ARCH`: `arm64`,
`x64`. The script downloads the matching Node binary from `nodejs.org/dist`.
Exotic arches (e.g. `linux-armv6l` on Raspberry Pi) require swapping the
download base URL for `unofficial-builds.nodejs.org/download/release` — not
needed for the initial macOS/Windows/Linux release.

Downloads are cached under `desktop/.node-cache/` (git-ignored).

## Sidecar layout

```
desktop/sidecar/
├── node                  # bundled Node 22 runtime (node.exe on Windows)
├── entry.js              # esbuild bundle of backend/src/entry/tauri.ts
├── entry.js.map
├── package.json          # {"type":"module"} + runtime dep list (for npm)
├── migrations/           # backend/src/db/migrations/*.sql copied verbatim
├── prebuilds/            # standalone asset files (tesseract traineddata)
└── node_modules/         # externals Node resolves at runtime — see below
```

### Why `node_modules/` and not everything under `prebuilds/`

`PLAN.md` originally called the native tree `prebuilds/`. In practice, the
native packages (`sharp`, `@napi-rs/canvas`, `@node-rs/argon2`,
`@electric-sql/pglite`, `pdfjs-dist`, `tesseract.js`, `pg`, `fastify`, …)
only resolve when placed under `node_modules/` — the esbuild bundle marks
them `--external` and Node's default resolver finds them from there.

`prebuilds/` is kept for asset files the app loads by explicit path — right
now that's the `eng.traineddata` / `fra.traineddata` packs used by
tesseract when scanning receipts. The PGlite `.wasm` and pdfjs worker are
resolved via their own package's `exports` map (both `new URL(..., import.meta.url)`
patterns), so they don't need to be copied — the packages already carry
them under `node_modules/`.

### What the sidecar bundles

- **`node`** — official Node 22 build for the target OS/arch. Full runtime,
  no stripping. ~30–40 MB per platform.
- **`entry.js`** — ~280 KB. Contains all pure-JS source: Fastify handlers,
  Drizzle schema, domain code, Zod schemas. Every runtime `dependency` from
  `backend/package.json` is marked `--external` so bundling doesn't try to
  pull in native `.node` files.
- **`node_modules/`** — populated by `npm install --omit=dev` inside the
  sidecar dir. Contains all runtime deps + transitives. Native addons:
  - `sharp` + `@img/sharp-darwin-arm64` (or matching platform) + libvips
  - `@napi-rs/canvas` + its `-darwin-arm64` binding
  - `@node-rs/argon2` + its `-darwin-arm64` binding
  - `pg` (JS-only when `pg-native` isn't installed — we don't install it)
  - `@electric-sql/pglite` (WASM under `dist/`)
  - `pdfjs-dist` (worker under `build/`)
  - `tesseract.js` + `tesseract.js-core` (WASM under `tesseract.js-core/`)
- **`migrations/`** — plain `.sql` files. `runMigrations()` in the bundle
  resolves them via `path.dirname(fileURLToPath(import.meta.url))` +
  `./migrations`; with the bundle at `desktop/sidecar/entry.js` that lands
  here.
- **`prebuilds/`** — tesseract traineddata packs. Copied from repo root
  (`eng.traineddata`, `fra.traineddata`) when present.

## Boot behaviour

```bash
./desktop/sidecar/node ./desktop/sidecar/entry.js
```

Prints one machine-readable line to stdout — `ATHENA_PORT=<n>` — after
Fastify binds `127.0.0.1:0` (OS-assigned port). The Rust shell greps for
that line and opens its WebView at `http://127.0.0.1:<n>/`. `SIGTERM`
triggers a clean Fastify close + `pool.end()` before exit.

Smoke test:

```bash
./desktop/sidecar/node ./desktop/sidecar/entry.js &
# … grab the port from stdout, then:
curl 127.0.0.1:<port>/health   # → {"ok":true,"ts":"…"}
kill %1
```

The sidecar pins `DB_DRIVER=pglite`, `AUTH_MODE=none`,
`PGLITE_PATH=$DATA_DIR/athena.db`, `SERVE_STATIC=true`. `DATA_DIR` defaults
to the current working directory (see `backend/src/dataDir.ts`); Tauri will
pass the OS-appropriate app-data path.

## Running the Tauri shell (dev)

The Rust shell lives in `desktop/src-tauri/`. Once the sidecar is built and
[Tauri CLI](https://tauri.app/start/prerequisites/) is installed
(`cargo install tauri-cli --version "^2.0"`), from `desktop/`:

```bash
cargo tauri dev
```

The shell spawns `./sidecar/node ./sidecar/entry.js`, watches its stdout
for the `ATHENA_PORT=<n>` handshake line, then opens the main window at
`http://127.0.0.1:<n>/`. Closing the window sends SIGKILL to the sidecar
child (its own SIGTERM handler in `backend/src/entry/tauri.ts` handles
graceful shutdown before that if the shell exits via `ExitRequested`).

In dev the shell resolves the sidecar at `<repo>/desktop/sidecar/`; in a
packaged build the whole `sidecar/` directory is bundled as a resource and
resolved via Tauri's `resource_dir`.

## Notes for the packaging workflow

- The whole `desktop/sidecar/` tree is Tauri's sidecar resource — bundle it
  as-is under the app's resource dir.
- Bundle size per platform is ~50–80 MB uncompressed (Node ~30 MB + native
  addons ~15–20 MB + traineddata packs ~6 MB + pglite/pdfjs/tesseract-core
  a few MB more).
- Each CI matrix job runs `build-sidecar.mjs` on its own runner (native
  install picks up the right prebuilt binaries via npm) — no cross-compile
  gymnastics.
- Nothing in `desktop/sidecar/` is committed; everything is git-ignored and
  regenerated by the build script.
