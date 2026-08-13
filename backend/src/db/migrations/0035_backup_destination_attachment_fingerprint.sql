-- Fingerprint of the user's attachment library at the time of the last
-- successful scheduled backup. The scheduler compares this against a
-- fresh fingerprint every tick and only uploads a new
-- athena-attachments-YYYY-MM-DD-HHMMSS.bin archive when the two differ,
-- so an unchanged receipt library doesn't burn bandwidth or slot in the
-- keepLast retention window.
--
-- Content: sha256("<count>::<maxCreatedAtISO or empty>"), stored as hex.
-- NULL means "never uploaded an attachment archive" — the first run
-- always uploads.
ALTER TABLE backup_destinations
  ADD COLUMN last_attachment_fingerprint TEXT;
