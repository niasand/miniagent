ALTER TABLE agent_profiles
ADD COLUMN runtime_kind TEXT NOT NULL DEFAULT 'cli'
  CHECK (runtime_kind IN ('cli', 'acp'));

ALTER TABLE agent_profiles
ADD COLUMN transport_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(transport_json));

ALTER TABLE agent_runs
ADD COLUMN runtime_kind TEXT NOT NULL DEFAULT 'cli'
  CHECK (runtime_kind IN ('cli', 'acp'));

ALTER TABLE agent_runs
ADD COLUMN external_session_id TEXT;

ALTER TABLE agent_runs
ADD COLUMN checkpoint_id TEXT;

ALTER TABLE agent_runs
ADD COLUMN protocol_state_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(protocol_state_json));

ALTER TABLE agent_runs
ADD COLUMN cancel_state TEXT
  CHECK (cancel_state IS NULL OR cancel_state IN ('requested', 'acknowledged', 'killed'));

CREATE TABLE permission_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  run_id TEXT NOT NULL REFERENCES agent_runs(id),
  task_id TEXT REFERENCES tasks(id),
  event_id TEXT REFERENCES events(id),
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

CREATE INDEX idx_permission_requests_run_status ON permission_requests(run_id, status);
CREATE INDEX idx_permission_requests_session_status ON permission_requests(session_id, status);

CREATE INDEX idx_agent_runs_external_session ON agent_runs(agent_type, external_session_id);

UPDATE agent_profiles
SET capabilities_json = json_set(capabilities_json, '$.runtimeKind', runtime_kind)
WHERE json_valid(capabilities_json);
