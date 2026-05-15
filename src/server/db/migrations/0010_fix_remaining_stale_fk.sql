-- Fix remaining stale FK references from 0008 migration
-- Several tables still reference _sessions_old, _events_old, _agent_runs_old, _tasks_old
-- because SQLite captured the renamed table names during ALTER TABLE RENAME.

-- 1. context_budgets
ALTER TABLE context_budgets RENAME TO _context_budgets_old;
CREATE TABLE context_budgets (
  session_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'warning', 'critical', 'overflow')),
  token_estimate INTEGER NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),
  budget_tokens INTEGER NOT NULL CHECK (budget_tokens > 0),
  usage_ratio REAL NOT NULL DEFAULT 0 CHECK (usage_ratio >= 0),
  warning_threshold REAL NOT NULL DEFAULT 0.70
    CHECK (warning_threshold > 0 AND warning_threshold < 1),
  critical_threshold REAL NOT NULL DEFAULT 0.85
    CHECK (critical_threshold > warning_threshold AND critical_threshold < 1),
  overflow_threshold REAL NOT NULL DEFAULT 0.95
    CHECK (overflow_threshold > critical_threshold AND overflow_threshold <= 1),
  source_event_start_id TEXT,
  source_event_end_id TEXT,
  source_global_seq INTEGER NOT NULL DEFAULT 0 CHECK (source_global_seq >= 0),
  current_context_pack_id TEXT,
  last_compacted_at TEXT,
  overflow_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO context_budgets SELECT * FROM _context_budgets_old;
DROP TABLE _context_budgets_old;

-- 2. context_packs
ALTER TABLE context_packs RENAME TO _context_packs_old;
CREATE TABLE context_packs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_run_id TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'failed', 'superseded')),
  source_event_start_id TEXT NOT NULL,
  source_event_end_id TEXT NOT NULL,
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
INSERT INTO context_packs SELECT * FROM _context_packs_old;
DROP TABLE _context_packs_old;

-- 3. memory_archives
ALTER TABLE memory_archives RENAME TO _memory_archives_old;
CREATE TABLE memory_archives (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  archive_date TEXT NOT NULL,
  source_event_start_id TEXT NOT NULL,
  source_event_end_id TEXT NOT NULL,
  source_global_seq_start INTEGER NOT NULL CHECK (source_global_seq_start > 0),
  source_global_seq_end INTEGER NOT NULL CHECK (source_global_seq_end >= source_global_seq_start),
  raw_events_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (session_id, archive_date),
  CHECK (json_valid(raw_events_json)),
  CHECK (json_valid(summary_json))
);
INSERT INTO memory_archives SELECT * FROM _memory_archives_old;
DROP TABLE _memory_archives_old;

-- 4. messages
ALTER TABLE messages RENAME TO _messages_old;
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(metadata_json))
);
INSERT INTO messages SELECT * FROM _messages_old;
DROP TABLE _messages_old;

-- 5. permission_requests
ALTER TABLE permission_requests RENAME TO _permission_requests_old;
CREATE TABLE permission_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  task_id TEXT,
  event_id TEXT,
  acp_request_id TEXT,
  protocol TEXT NOT NULL DEFAULT 'acp' CHECK (protocol IN ('acp', 'legacy_cli')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'cancelled', 'expired')),
  prompt TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]',
  tool_call_json TEXT NOT NULL DEFAULT '{}',
  selected_option_id TEXT,
  expires_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (json_valid(options_json)),
  CHECK (json_valid(tool_call_json)),
  UNIQUE (run_id, acp_request_id)
);
INSERT INTO permission_requests SELECT * FROM _permission_requests_old;
DROP TABLE _permission_requests_old;

-- 6. projector_offsets
ALTER TABLE projector_offsets RENAME TO _projector_offsets_old;
CREATE TABLE projector_offsets (
  projector_name TEXT PRIMARY KEY,
  last_global_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_global_seq >= 0),
  last_event_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO projector_offsets SELECT * FROM _projector_offsets_old;
DROP TABLE _projector_offsets_old;

-- 7. schedules
ALTER TABLE schedules RENAME TO _schedules_old;
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  kind TEXT NOT NULL CHECK (kind IN ('once', 'cron')),
  cron_expr TEXT,
  run_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  payload_json TEXT NOT NULL DEFAULT '{}',
  next_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  locked_by TEXT,
  locked_at TEXT,
  lease_expires_at TEXT,
  last_run_at TEXT,
  CHECK (json_valid(payload_json)),
  CHECK ((kind = 'cron' AND cron_expr IS NOT NULL) OR (kind = 'once' AND run_at IS NOT NULL))
);
INSERT INTO schedules SELECT * FROM _schedules_old;
DROP TABLE _schedules_old;
