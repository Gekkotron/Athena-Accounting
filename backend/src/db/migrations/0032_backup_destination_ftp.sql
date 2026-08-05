-- FTP joins webdav/folder as a remote-backup destination kind. Motivation:
-- the Freebox's disk only speaks FTP/SMB — it has no WebDAV server — and
-- FTP is the one a Node process can reach without a host-level mount.
ALTER TABLE backup_destinations DROP CONSTRAINT backup_destinations_kind_check;
ALTER TABLE backup_destinations ADD CONSTRAINT backup_destinations_kind_check
  CHECK (kind IN ('webdav', 'folder', 'ftp'));
