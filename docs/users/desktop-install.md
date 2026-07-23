---
title: Desktop install
sidebar_position: 3
---

# Desktop install

The desktop app is the "no install, no Docker" way to run Athena. It's a
single application on macOS, Windows, or Linux — you double-click it, a
window opens, and everything (database, backend, UI) runs inside that
process on your own machine. No LAN, no other users, no cloud.

If you want a family server that everyone in the household connects to,
skip this page and read **[Getting started with Docker](getting-started.md)**
instead.

## Download

Pick the file for your OS from the latest release:

- **[Latest release on GitHub](https://github.com/Gekkotron/Athena-Accounting/releases/latest)**

| OS | File |
|----|------|
| macOS (Apple Silicon or Intel) | `Athena-Accounting_<version>_universal.dmg` |
| Windows 10 / 11 (x64) | `Athena-Accounting_<version>_x64-setup.exe` |
| Linux (x64) | `Athena-Accounting_<version>_amd64.AppImage` |

Each artifact is built by the `desktop-release` GitHub Actions workflow
straight from a tagged commit on `main`. Checksums are published next to
the artifacts on the same release page.

## First run

### macOS

The app is **ad-hoc code-signed** but not notarized by Apple (no Developer
ID yet). That's enough for the signature to be valid, but macOS Sonoma
(14) tightened Gatekeeper and macOS Sequoia / Tahoe (15/26) tightened it
further — any browser-downloaded artifact carries a
`com.apple.quarantine` extended attribute, and on those OS versions
Gatekeeper refuses to launch ad-hoc-signed quarantined apps, with the
misleading *"Athena Accounting est endommagé et ne peut pas être
ouvert"* dialog. Right-click → Open no longer bypasses this.

The one-shot cure is a single Terminal command that strips the quarantine
attribute:

1. Open the `.dmg` and drag **Athena Accounting** into `Applications`.
2. Open **Terminal** and run:
   ```bash
   xattr -cr "/Applications/Athena Accounting.app"
   ```
3. Double-click the app in Finder. It launches normally from now on.

If you're on an older macOS (12/13) that still accepts ad-hoc bundles,
you may see the softer *"unidentified developer"* dialog instead — in
that case, right-click the app → **Open** → confirm **Open** in the
follow-up prompt and macOS will remember the choice.

Once the project has an Apple Developer ID and notarizes releases, none
of this will be needed.

### Windows

1. Run the `.exe` installer. SmartScreen shows *"Windows protected your
   PC"* because the binary is not code-signed. Click **More info** →
   **Run anyway**.
2. The installer creates a Start-menu entry and a desktop shortcut.

### Linux

1. Mark the `.AppImage` executable: `chmod +x Athena-Accounting_*.AppImage`.
2. Double-click it, or run it from a terminal.

### After the window opens

You'll see the same **onboarding screen** the Docker install shows:
pick a username and a password. In desktop mode there is only ever one
user, so this is really just your local password to unlock the app —
but it's still hashed with argon2id before touching the local database.

From there, the rest of the docs apply unchanged: create an account,
import a statement, categorise transactions. See
**[Your first ten minutes](getting-started.md#your-first-ten-minutes)**.

## Where your data lives

The app writes everything — the PGlite database file, uploaded
statements, backup exports — under a per-OS **data directory**. Nothing
leaves that directory; there is no network traffic beyond localhost.

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Athena Accounting/` |
| Windows | `%APPDATA%\Athena Accounting\` (typically `C:\Users\<you>\AppData\Roaming\Athena Accounting\`) |
| Linux | `~/.local/share/Athena Accounting/` (or `$XDG_DATA_HOME/Athena Accounting/` if set) |

Inside you'll find:

- `athena.db` — the PGlite database (all your accounts, transactions,
  rules, budgets).
- `uploads/` — copies of the statement files you imported.
- `backups/` — backup exports triggered from the UI or via the MCP
  endpoint.

You can override the location by setting the `ATHENA_DATA_DIR`
environment variable before launching the app (useful if you keep the
DB on an external drive).

## How to back up

Two ways, use both:

**1. Backup export from the UI.** *Settings → Backup → Export*.
This writes a single JSON file containing every account, transaction,
checkpoint, split, rule, category, and budget. It's the same format the
Docker install uses, so you can move a database between the two
distributions if you ever want to.

**2. Copy the data directory.** Quit the app, then copy the whole
data directory above (or just `athena.db`) to your backup location —
another disk, a NAS, a cloud sync folder. The PGlite file is a single
file; a plain `cp`/`copy` is enough. Restore by putting the file back
before launching the app.

The `athena_backup_last_success_timestamp_seconds` Prometheus metric
that the Docker path exposes is not surfaced in desktop mode — nothing
scrapes it. Use a calendar reminder instead.

## Uninstall

- **macOS** — drag the app to the Trash, then delete
  `~/Library/Application Support/Athena Accounting/` if you also want
  your data gone.
- **Windows** — *Settings → Apps → Athena Accounting → Uninstall*, then
  delete `%APPDATA%\Athena Accounting\` for the data.
- **Linux** — delete the `.AppImage`, then delete
  `~/.local/share/Athena Accounting/`.

## MCP from the desktop app

The MCP server is still available in desktop mode: the app writes its
current port to `${DATA_DIR}/.mcp-port` on boot, and the *Settings →
MCP* screen offers a **Copy MCP config** button that produces a
ready-to-paste snippet for Claude Desktop / Cursor / any other MCP
client. See **[MCP access](mcp.md)** for the full walkthrough.

## Known limitations

- **Single user.** Desktop mode runs with `AUTH_MODE=none` internally.
  If you need multiple people to share the same instance, use the
  Docker path.
- **No LAN access.** The backend binds to `127.0.0.1` on a
  system-assigned port. Other devices on your network cannot reach it,
  by design.
- **Unsigned / non-notarized binaries** on macOS (ad-hoc only) and
  Windows. This will change once the project has an Apple Developer
  account; in the meantime macOS users pay a one-shot `xattr -cr` cost
  after install (see **First run → macOS** above), and Windows users
  click through *Run anyway* in SmartScreen.
- **Bundle size** is 50–80 MB per platform. The sidecar carries a full
  Node runtime plus a handful of native modules (sharp, canvas, argon2,
  PGlite, pdfjs, tesseract); a leaner bundle isn't worth the fragility.

← [Back to user docs](README.md)
