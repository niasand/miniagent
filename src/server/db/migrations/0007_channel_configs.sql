CREATE TABLE IF NOT EXISTS channel_configs (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(channel_id, key)
);

CREATE INDEX IF NOT EXISTS idx_channel_configs_channel ON channel_configs(channel_id);
