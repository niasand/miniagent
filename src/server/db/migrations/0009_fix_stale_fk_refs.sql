-- Fix stale FK references from 0008 migration
-- events and agent_runs still referenced _sessions_old / _tasks_old
-- because SQLite captured the renamed table names in FK constraints.
-- Recreate both tables with corrected REFERENCES (or no FK to avoid future issues).

-- 1. Fix events table
ALTER TABLE events RENAME TO _events_old;
CREATE TABLE events (
  global_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  run_id TEXT,
  task_id TEXT,
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
INSERT INTO events SELECT * FROM _events_old;
DROP TABLE _events_old;

-- 2. Fix agent_runs table
ALTER TABLE agent_runs RENAME TO _agent_runs_old;
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT,
  agent_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'starting', 'running', 'waiting_permission', 'compacting', 'stopping',
      'succeeded', 'failed', 'cancelled', 'overflowed'
    )),
  launch_spec_json TEXT NOT NULL DEFAULT '{}',
  pid INTEGER,
  context_pack_id TEXT,
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
  runtime_kind TEXT NOT NULL DEFAULT 'cli' CHECK (runtime_kind IN ('cli', 'acp')),
  external_session_id TEXT,
  checkpoint_id TEXT,
  protocol_state_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(protocol_state_json)),
  cancel_state TEXT CHECK (cancel_state IS NULL OR cancel_state IN ('requested', 'acknowledged', 'killed')),
  CHECK (json_valid(launch_spec_json)),
  CHECK (first_global_seq IS NULL OR last_global_seq IS NULL OR last_global_seq >= first_global_seq)
);
INSERT INTO agent_runs SELECT * FROM _agent_runs_old;
DROP TABLE _agent_runs_old;
