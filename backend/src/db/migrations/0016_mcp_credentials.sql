-- MCP access credentials, per user. Dedicated columns (not the settings JSONB)
-- because SettingsSchema is .strict(): an unknown JSONB key would make
-- mergeSettings reject the whole blob and reset dashboard settings to defaults.
ALTER TABLE user_settings
  ADD COLUMN mcp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN mcp_key_wrapped text;
