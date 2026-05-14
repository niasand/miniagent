CREATE TABLE operation_confirmations (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('medium', 'high', 'critical')),
  prompt TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'expired', 'consumed', 'cancelled')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('web_user', 'feishu_user', 'system', 'agent')),
  actor_ref TEXT,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  consumed_at TEXT,
  CHECK (json_valid(payload_json))
);

CREATE INDEX idx_operation_confirmations_status_expires
ON operation_confirmations(status, expires_at);

CREATE INDEX idx_operation_confirmations_resource
ON operation_confirmations(resource_type, resource_id);
