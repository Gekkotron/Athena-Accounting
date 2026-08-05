-- Per-user remote backup destination for scheduled, unattended backups
-- (WebDAV server or local/mounted folder). One row per user, like
-- bank_sync_credentials.
--
-- Design notes:
--   * config is non-secret JSON: webdav {url, username, subdir?}, folder
--     {path}, shared {keepLast}.
--   * secret_encrypted (WebDAV password, NULL for folder) and
--     passphrase_encrypted (the enc1 backup passphrase — stored because
--     scheduled runs must seal the dump unattended) are both
--     base64(nonce || ciphertext || tag) from AES-256-GCM under a
--     SESSION_SECRET-derived key with the user id + field bound as AAD
--     (see backend/src/domain/backup/secrets.ts). Plaintext is never
--     stored and never returned by any endpoint.
CREATE TABLE backup_destinations (
  user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (kind IN ('webdav', 'folder')),
  config                JSONB NOT NULL,
  secret_encrypted      TEXT,
  passphrase_encrypted  TEXT NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at           TIMESTAMPTZ,
  last_error            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
