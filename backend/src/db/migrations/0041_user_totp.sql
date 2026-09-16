-- TOTP 2FA (RFC 6238) — optional per-user second factor on login. Two
-- tables so DELETE-on-disable stays trivial and neither row leaks into
-- every user-object SELECT.
-- See docs/superpowers/specs/2026-09-11-totp-2fa-design.md.
--
-- secret_ciphertext is a base64-encoded AES-256-GCM envelope
-- (nonce || ciphertext || tag) under a key derived from SESSION_SECRET
-- via HKDF-SHA256, with the owning user_id bound as AAD — same shape as
-- domain/bank-sync/crypto.ts. Rotating SESSION_SECRET invalidates every
-- enrolled secret (documented; matches session-cookie rotation behaviour).
--
-- enabled_at NULL = pending enrolment (secret generated, code never
-- confirmed). A pending row is harmless without confirmation; a second
-- enrol attempt REPLACEs it. No timer-based cleanup.
CREATE TABLE user_totp (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext  TEXT NOT NULL,
  enabled_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recovery codes: 10 per user at enrolment, argon2id-hashed at rest (same
-- ARGON2_OPTS as passwords). One-shot — a successful match burns the row
-- by setting used_at. Deleting the user_totp row cascades to these.
CREATE TABLE user_totp_recovery_codes (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index makes the /verify path's "find an unused code for this
-- user" scan O(remaining unused), not O(all codes ever generated).
CREATE INDEX user_totp_recovery_codes_user_unused_idx
  ON user_totp_recovery_codes (user_id) WHERE used_at IS NULL;
