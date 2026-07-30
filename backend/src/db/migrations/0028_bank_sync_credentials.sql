-- Per-user Enable Banking application credentials for the optional bank-sync
-- connector. Each user brings their own free enablebanking.com application
-- (restricted production mode, own accounts only): the application ID plus
-- the RS256 private key used to sign API JWTs.
--
-- Design notes:
--   * user_id is the primary key — exactly one credential set per user;
--     replacing it is an upsert, not an append.
--   * private_key_encrypted holds base64(nonce || ciphertext || tag) from
--     AES-256-GCM under a SESSION_SECRET-derived key with the user id bound
--     as AAD (see backend/src/domain/bank-sync/crypto.ts). The plaintext PEM
--     is never stored and never returned by any endpoint.
CREATE TABLE bank_sync_credentials (
  user_id                INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  application_id         TEXT NOT NULL,
  private_key_encrypted  TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
