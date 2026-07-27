---
title: Encryption at rest
sidebar_position: 8
---

# Encryption at rest

"Encryption at rest" means protecting the database file itself — so that
someone who gets hold of your disk, your backup drive, or your server's
filesystem can't just read your accounts and transactions out of it. Athena
handles this differently depending on which of its two database drivers you
run:

- **Desktop app (PGlite)** — Athena can encrypt the database file itself.
  This is opt-in, from Settings.
- **Docker / home server (Postgres)** — Athena does **not** encrypt
  Postgres's files. Protecting them is a host/volume-level job, described
  below.

## Desktop (PGlite)

Encryption at rest is off by default. Turn it on from **Settings →
Security → Enable encryption**, where you set a password.

**What enabling it actually does.** Once enabled, the database no longer
lives on disk as a plain PGlite cluster. It runs entirely **in memory**
while the app is open, and the only thing written to disk going forward is
a single **AES-256-GCM encrypted snapshot**, sealed under a key derived
from your password with scrypt. Nothing readable is written to disk
*after* that point — but enabling itself doesn't remove the previous
plaintext copy immediately: **you need to restart the app once** after
enabling for the migration to finish and the old plaintext database
directory to actually be deleted. Until that restart happens, the
plaintext copy still sits alongside the new encrypted snapshot on disk.
The snapshot lives in your data directory (see
[Desktop install](desktop-install.md) for where that is) as two files:

- `athena.db.enc` — the current encrypted snapshot.
- `athena.db.enc.bak` — the previous one, kept as a fallback in case a
  write is interrupted mid-rotation.

**When the snapshot refreshes.** Athena doesn't re-encrypt on every single
change — that would thrash the disk. Instead it debounces: about **10
seconds** after your last change, it writes a fresh snapshot. If you keep
making changes continuously (a long import, for example) the debounce keeps
getting pushed back, but only up to a **60-second ceiling** — after a
minute of nonstop writes, it flushes anyway rather than postponing forever.
Athena also always writes one final snapshot on a clean quit.

**The crash window.** Because of that debounce, a hard crash or force-quit
can lose whatever changed in the last few seconds since the last snapshot
was written — normal app closes don't have this problem, only an unclean
exit does.

**There is no password recovery.** If you forget the encryption password,
your data is gone — there is no reset, no backdoor, no support path to get
it back. Your only safety net is an **exported backup** made beforehand
(**Settings → Data → Backup**; see [Backup and recovery](backup-recovery.md)).
A backup is a separate file that's encrypted with **its own passphrase**,
independent of the encryption-at-rest password above — you choose it at
export time and are asked for it again at restore time. That backup
passphrase needs to be kept just as safe as the encryption password: if
you lose both the encryption password and the backup passphrase, there is
nothing left to recover — the backup being a separate file doesn't help if
its own passphrase is also gone.

**Changing or disabling the password.** Both are in **Settings →
Security**, and both require the current password to confirm you're
authorized:

- **Change password** re-encrypts the snapshot under a new password
  immediately; the old password stops working for that snapshot right
  away.
- **Disable encryption** doesn't take effect instantly — it's recorded and
  applied the **next time you start the app**. Until then the app keeps
  running exactly as before.

**Unlocking on launch.** Once encryption is enabled, starting the app shows
an unlock screen asking for your password before anything else loads.
Nothing is decrypted, and no other window is shown, until the correct
password is entered.

## Docker / home server (Postgres)

If you're running Athena as a Docker Compose stack against Postgres, none
of the above applies: **Athena does not encrypt the Postgres data
directory**. Anyone who has Docker access or root on the host machine can
read every account and transaction as plain rows — for example with
`docker exec -it <container> psql -U <user> -d <db>`, or simply by opening
the files under the bind-mounted `./postgres-data` directory with any
Postgres-aware tool. This is a Postgres/Docker property, not something
Athena's application layer can prevent from inside the container.

If that matters for your setup — a shared machine, a laptop that could be
lost or stolen while running — the fix is to encrypt at the **volume**
level, so the files backing `/var/lib/postgresql/data` are unreadable
without unlocking the underlying disk first.

**Linux host: LUKS.** Put the Postgres data on a LUKS-encrypted block
device and mount it, then point the compose bind mount at that mount
instead of a plain host directory:

```bash
cryptsetup luksFormat /dev/sdX1
cryptsetup open /dev/sdX1 athena-postgres
mkfs.ext4 /dev/mapper/athena-postgres
mkdir -p /mnt/encrypted/athena-postgres
mount /dev/mapper/athena-postgres /mnt/encrypted/athena-postgres
```

Then override the `db` service's volume with a
`docker-compose.override.yml` next to the main `docker-compose.yml`:

```yaml
services:
  db:
    volumes:
      - /mnt/encrypted/athena-postgres:/var/lib/postgresql/data
```

Docker Compose merges `docker-compose.override.yml` with
`docker-compose.yml` automatically, so no other change is needed. Whatever
was already in `./postgres-data` needs a one-time copy over to the new
mount before you bring the stack back up.

An **encrypted ZFS or Btrfs dataset** achieves the same thing without a
separate LUKS layer, if your host already uses one of those filesystems —
create the dataset with encryption enabled and mount it at the same path.

**Desktop-class hosts (running Docker Desktop on a laptop, say).** Full-disk
encryption covers the same threat with no compose changes at all:
**FileVault** on macOS, **BitLocker** on Windows. Either one protects the
whole disk — including `./postgres-data` — whenever the machine is off or
locked.

## Threat model

| Scenario | Desktop (PGlite) | Docker/LAN (Postgres) |
| --- | --- | --- |
| Device stolen or drive removed **while powered off** | Protected — only an encrypted snapshot exists on disk (after the restart that follows enabling; until that restart, the plaintext copy is still there too) | Protected, **if** you've set up volume/full-disk encryption as above |
| Attacker with **live** root or Docker access on the running host | **Not protected** — a live process can be asked to decrypt the data it's already using | **Not protected** — Docker/root access reads the running database directly, encrypted volume or not |
| Password/passphrase lost | Data unrecoverable except from a prior exported backup | LUKS passphrase lost ⇒ that volume's data is unrecoverable |

Neither mode defends against an attacker who already has control of the
running host — encryption at rest is about protecting data **at rest**
(powered off, disk removed, drive stolen), not about sandboxing a
compromised machine.

## See also

- [Security and privacy](security-and-privacy.md) — the wider security
  model (auth, network binding, MCP tokens).
- [Backup and recovery](backup-recovery.md) — exporting and restoring the
  one copy of your data that doesn't depend on the encryption password.
- [Desktop install](desktop-install.md) — where `$DATA_DIR` lives per OS.

← [Back to user docs](README.md)
