CREATE TABLE agent_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  command TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  default_args_json TEXT NOT NULL DEFAULT '[]',
  health_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('unknown', 'healthy', 'missing', 'auth_required', 'failed')),
  last_probe_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(capabilities_json)),
  CHECK (json_valid(default_args_json))
);

CREATE TABLE agent_defaults (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'channel', 'workspace', 'system')),
  scope_ref TEXT NOT NULL,
  agent_type TEXT NOT NULL REFERENCES agent_profiles(id),
  params_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (scope_type, scope_ref),
  CHECK (json_valid(params_json))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  agent_type TEXT NOT NULL REFERENCES agent_profiles(id),
  workspace_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'compacting', 'failed', 'archived')),
  channel_type TEXT CHECK (channel_type IS NULL OR channel_type IN ('web', 'feishu')),
  channel_ref TEXT,
  default_params_json TEXT NOT NULL DEFAULT '{}',
  active_run_id TEXT REFERENCES agent_runs(id) DEFERRABLE INITIALLY DEFERRED,
  current_context_pack_id TEXT REFERENCES context_packs(id) DEFERRABLE INITIALLY DEFERRED,
  source_session_id TEXT REFERENCES sessions(id),
  source_context_pack_id TEXT REFERENCES context_packs(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  CHECK (json_valid(default_params_json))
);

CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_channel ON sessions(channel_type, channel_ref);
CREATE INDEX idx_sessions_agent_type ON sessions(agent_type);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('web', 'feishu', 'cron', 'handoff', 'mcp', 'system')),
  source_ref TEXT,
  type TEXT NOT NULL CHECK (type IN ('message', 'compact', 'handoff', 'schedule_run', 'stop', 'resume')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('scheduled', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused')),
  target_agent_type TEXT REFERENCES agent_profiles(id),
  input_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT,
  run_id TEXT REFERENCES agent_runs(id) DEFERRABLE INITIALLY DEFERRED,
  queued_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(input_json))
);

CREATE UNIQUE INDEX idx_tasks_dedupe_key
ON tasks(dedupe_key)
WHERE dedupe_key IS NOT NULL;

CREATE INDEX idx_tasks_session_status ON tasks(session_id, status);
CREATE INDEX idx_tasks_source ON tasks(source_type, source_ref);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  task_id TEXT REFERENCES tasks(id),
  agent_type TEXT NOT NULL REFERENCES agent_profiles(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'starting', 'running', 'waiting_permission', 'compacting', 'stopping',
      'succeeded', 'failed', 'cancelled', 'overflowed'
    )),
  launch_spec_json TEXT NOT NULL DEFAULT '{}',
  pid INTEGER,
  context_pack_id TEXT REFERENCES context_packs(id) DEFERRABLE INITIALLY DEFERRED,
  first_global_seq INTEGER,
  last_global_seq INTEGER,
  heartbeat_at TEXT,
  started_at TEXT,
  stopped_at TEXT,
  exit_code INTEGER,
  stop_reason TEXT,
  error_class TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(launch_spec_json)),
  CHECK (first_global_seq IS NULL OR last_global_seq IS NULL OR last_global_seq >= first_global_seq)
);

CREATE UNIQUE INDEX idx_one_active_run_per_session
ON agent_runs(session_id)
WHERE status IN ('queued', 'starting', 'running', 'waiting_permission', 'compacting', 'stopping');

CREATE INDEX idx_agent_runs_session_status ON agent_runs(session_id, status);
CREATE INDEX idx_agent_runs_task ON agent_runs(task_id);

CREATE TABLE events (
  global_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  run_id TEXT REFERENCES agent_runs(id),
  task_id TEXT REFERENCES tasks(id),
  run_seq INTEGER,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  schema_version INTEGER NOT NULL DEFAULT 1,
  causation_id TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(payload_json)),
  CHECK (schema_version > 0),
  CHECK (run_seq IS NULL OR run_seq > 0),
  CHECK ((run_id IS NULL AND run_seq IS NULL) OR (run_id IS NOT NULL AND run_seq IS NOT NULL))
);

CREATE INDEX idx_events_session_global_seq ON events(session_id, global_seq);
CREATE UNIQUE INDEX idx_events_run_seq ON events(run_id, run_seq) WHERE run_id IS NOT NULL;
CREATE INDEX idx_events_type_global_seq ON events(type, global_seq);
CREATE INDEX idx_events_correlation ON events(correlation_id);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  event_id TEXT REFERENCES events(id),
  event_global_seq INTEGER REFERENCES events(global_seq),
  channel_type TEXT NOT NULL CHECK (channel_type IN ('web', 'feishu')),
  target_ref TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('web_event', 'feishu_card_create', 'feishu_card_update', 'feishu_text')),
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

CREATE INDEX idx_outbox_status_next_attempt ON outbox(status, next_attempt_at);
CREATE INDEX idx_outbox_session_created ON outbox(session_id, created_at);
CREATE INDEX idx_outbox_locked_at ON outbox(locked_at);
CREATE INDEX idx_outbox_lease ON outbox(status, lease_expires_at);

CREATE TABLE projector_offsets (
  projector_name TEXT PRIMARY KEY,
  last_global_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_global_seq >= 0),
  last_event_id TEXT REFERENCES events(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  run_id TEXT REFERENCES agent_runs(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  source_event_id TEXT NOT NULL REFERENCES events(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(metadata_json))
);

CREATE INDEX idx_messages_session_created ON messages(session_id, created_at);
CREATE INDEX idx_messages_source_event ON messages(source_event_id);

CREATE TABLE context_packs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  source_run_id TEXT REFERENCES agent_runs(id),
  schema_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'failed', 'superseded')),
  source_event_start_id TEXT NOT NULL REFERENCES events(id),
  source_event_end_id TEXT NOT NULL REFERENCES events(id),
  token_estimate INTEGER CHECK (token_estimate IS NULL OR token_estimate >= 0),
  summary_json TEXT NOT NULL DEFAULT '{}',
  recent_messages_json TEXT NOT NULL DEFAULT '[]',
  key_files_json TEXT NOT NULL DEFAULT '[]',
  open_tasks_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL CHECK (created_by IN ('system', 'user', 'agent')),
  strategy TEXT NOT NULL CHECK (strategy IN ('native_compact', 'miniagent_summary', 'manual')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (schema_version > 0),
  CHECK (json_valid(summary_json)),
  CHECK (json_valid(recent_messages_json)),
  CHECK (json_valid(key_files_json)),
  CHECK (json_valid(open_tasks_json))
);

CREATE INDEX idx_context_packs_session_created ON context_packs(session_id, created_at);
CREATE INDEX idx_context_packs_status ON context_packs(status);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  kind TEXT NOT NULL CHECK (kind IN ('once', 'cron')),
  cron_expr TEXT,
  run_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  payload_json TEXT NOT NULL DEFAULT '{}',
  next_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(payload_json)),
  CHECK ((kind = 'cron' AND cron_expr IS NOT NULL) OR (kind = 'once' AND run_at IS NOT NULL))
);

CREATE INDEX idx_schedules_status_next_run ON schedules(status, next_run_at);
CREATE INDEX idx_schedules_session ON schedules(session_id);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('web_user', 'feishu_user', 'system', 'agent')),
  actor_ref TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(payload_json))
);

CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_actor_created ON audit_logs(actor_type, actor_ref, created_at);

INSERT OR IGNORE INTO agent_profiles (
  id, display_name, command, capabilities_json, default_args_json
) VALUES
  ('codex', 'Codex CLI', 'codex', '{"runtime":"codex-cli"}', '[]'),
  ('claude', 'Claude Code', 'claude', '{"runtime":"claude-code"}', '[]'),
  ('trae', 'Trae CLI', 'trae', '{"runtime":"trae-cli"}', '[]');

INSERT OR IGNORE INTO agent_defaults (
  id, scope_type, scope_ref, agent_type, params_json
) VALUES (
  'default-system-global', 'system', 'global', 'codex', '{}'
);
