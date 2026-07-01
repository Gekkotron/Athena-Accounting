-- Multi-user data isolation. Every data table gains a user_id column referencing
-- users(id) ON DELETE CASCADE; existing rows backfill to user_id = 1 (the
-- pre-multi-user singleton). After this migration, every route filters reads
-- and writes by req.session.userId so no user can see another user's data.

ALTER TABLE accounts                    ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE account_filename_patterns   ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE categories                  ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE rules                       ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE transfer_rules              ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE file_imports                ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE transactions                ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE pdf_statement_templates     ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE pdf_import_drafts           ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Backfill to user id=1 (the only user that could exist before this migration
-- because of the onboarding lockout).
--
-- Fresh-install guard: migration 0000 seeds a `Divers` category with
-- user_id = NULL. On an install where no user has ever onboarded (CI, first
-- boot from an empty volume) that seeded row would fail the FK when the
-- UPDATE below tries to point it at a nonexistent user 1. Drop the orphan
-- first; the onboarding endpoint reseeds `Divers` per-user on account
-- creation, so nothing is lost.
DELETE FROM categories WHERE user_id IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = 1);

UPDATE accounts                  SET user_id = 1 WHERE user_id IS NULL;
UPDATE account_filename_patterns SET user_id = 1 WHERE user_id IS NULL;
UPDATE categories                SET user_id = 1 WHERE user_id IS NULL;
UPDATE rules                     SET user_id = 1 WHERE user_id IS NULL;
UPDATE transfer_rules            SET user_id = 1 WHERE user_id IS NULL;
UPDATE file_imports              SET user_id = 1 WHERE user_id IS NULL;
UPDATE transactions              SET user_id = 1 WHERE user_id IS NULL;
UPDATE pdf_statement_templates   SET user_id = 1 WHERE user_id IS NULL;
UPDATE pdf_import_drafts         SET user_id = 1 WHERE user_id IS NULL;

ALTER TABLE accounts                    ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE account_filename_patterns   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE categories                  ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE rules                       ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transfer_rules              ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE file_imports                ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transactions                ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE pdf_import_drafts           ALTER COLUMN user_id SET NOT NULL;
-- pdf_statement_templates.user_id stays nullable; legacy rows from before the
-- per-account migration (0006) had no account either. Users can delete them
-- via /api/pdf-templates if they get in the way.

-- Per-user uniqueness on names. Two different users can each have a "Compte
-- Courant" account or a "Courses" category without colliding.
ALTER TABLE accounts   DROP CONSTRAINT IF EXISTS accounts_name_key;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;
CREATE UNIQUE INDEX accounts_user_name_idx   ON accounts(user_id, name);
CREATE UNIQUE INDEX categories_user_name_idx ON categories(user_id, name);

-- Hot-path indexes so the per-user filter lands on an index scan.
CREATE INDEX accounts_user_idx     ON accounts(user_id);
CREATE INDEX transactions_user_idx ON transactions(user_id);
CREATE INDEX file_imports_user_idx ON file_imports(user_id);
