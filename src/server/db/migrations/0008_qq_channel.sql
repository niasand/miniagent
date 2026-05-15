-- QQ channel support: widen CHECK constraints to include 'qq' values
-- Note: FK references removed from recreated tables because SQLite cannot
-- disable foreign_keys inside a transaction. FK enforcement is restored
-- when the server starts (applyPragmas sets foreign_keys = ON).

-- 1. sessions.channel_type: add 'qq'
ALTER TABLE sessions RENAME TO _sessions_old;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'compacting', 'failed', 'archived')),
  channel_type TEXT CHECK (channel_type IS NULL OR channel_type IN ('web', 'feishu', 'qq')),
  channel_ref TEXT,
  default_params_json TEXT NOT NULL DEFAULT '{}',
  active_run_id TEXT,
  current_context_pack_id TEXT,
  source_session_id TEXT,
  source_context_pack_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  CHECK (json_valid(default_params_json))
);
INSERT INTO sessions SELECT * FROM _sessions_old;
DROP TABLE _sessions_old;
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_channel ON sessions(channel_type, channel_ref);
CREATE INDEX idx_sessions_agent_type ON sessions(agent_type);

-- 2. tasks.source_type: add 'qq'
ALTER TABLE tasks RENAME TO _tasks_old;
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('web', 'feishu', 'qq', 'cron', 'handoff', 'mcp', 'system')),
  source_ref TEXT,
  type TEXT NOT NULL CHECK (type IN ('message', 'compact', 'handoff', 'schedule_run', 'stop', 'resume')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('scheduled', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused')),
  target_agent_type TEXT,
  input_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT,
  run_id TEXT,
  queued_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(input_json))
);
INSERT INTO tasks SELECT * FROM _tasks_old;
DROP TABLE _tasks_old;
CREATE UNIQUE INDEX idx_tasks_dedupe_key ON tasks(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_tasks_session_status ON tasks(session_id, status);
CREATE INDEX idx_tasks_source ON tasks(source_type, source_ref);

-- 3. outbox.channel_type + kind: add 'qq' and 'qq_markdown'
ALTER TABLE outbox RENAME TO _outbox_old;
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_id TEXT,
  event_global_seq INTEGER,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('web', 'feishu', 'qq')),
  target_ref TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('web_event', 'feishu_card_create', 'feishu_card_update', 'feishu_text', 'qq_markdown')),
  view_model_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT,
  locked_by TEXT,
  locked_at TEXT,
  lease_expires_at TEXT,
  provider_message_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  CHECK (json_valid(view_model_json)),
  CHECK (attempts >= 0),
  CHECK (max_attempts > 0)
);
INSERT INTO outbox SELECT * FROM _outbox_old;
DROP TABLE _outbox_old;
CREATE INDEX idx_outbox_status_next_attempt ON outbox(status, next_attempt_at);
CREATE INDEX idx_outbox_session_created ON outbox(session_id, created_at);
CREATE INDEX idx_outbox_locked_at ON outbox(locked_at);
CREATE INDEX idx_outbox_lease ON outbox(status, lease_expires_at);

-- 4. audit_logs.actor_type: add 'qq_user'
ALTER TABLE audit_logs RENAME TO _audit_logs_old;
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('web_user', 'feishu_user', 'qq_user', 'system', 'agent')),
  actor_ref TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(payload_json))
);
INSERT INTO audit_logs SELECT * FROM _audit_logs_old;
DROP TABLE _audit_logs_old;
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_actor_created ON audit_logs(actor_type, actor_ref, created_at);
