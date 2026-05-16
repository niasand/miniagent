-- 0001_initial.sql
-- MiniAgent backend schema: all tables for the event-sourced control plane.
-- No FK constraints (SQLite ALTER TABLE limitation).

-- Drop legacy tables from old schema
DROP TABLE IF EXISTS projector_offsets;
DROP TABLE IF EXISTS agent_profiles;

-- ============================================================
-- Sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY,
    title               TEXT NOT NULL DEFAULT '',
    agent_type          TEXT NOT NULL,
    workspace_path      TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'idle'
                        CHECK (status IN ('idle','running','compacting','failed','archived')),
    channel_type        TEXT
                        CHECK (channel_type IS NULL OR channel_type IN ('web','feishu','qq','telegram','discord')),
    channel_ref         TEXT,
    default_params_json TEXT NOT NULL DEFAULT '{}'
                        CHECK (json_valid(default_params_json)),
    active_run_id       TEXT,
    current_context_pack_id TEXT,
    source_session_id   TEXT,
    source_context_pack_id  TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    archived_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_status         ON sessions (status);
CREATE INDEX IF NOT EXISTS idx_sessions_channel        ON sessions (channel_type, channel_ref);
CREATE INDEX IF NOT EXISTS idx_sessions_agent_type     ON sessions (agent_type);

-- ============================================================
-- Tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    source_type     TEXT NOT NULL
                    CHECK (source_type IN ('web','feishu','qq','telegram','discord','cron','handoff','mcp','system')),
    source_ref      TEXT,
    type            TEXT NOT NULL
                    CHECK (type IN ('message','compact','handoff','schedule_run','stop','resume')),
    status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','queued','running','succeeded','failed','cancelled','paused')),
    target_agent_type TEXT,
    input_json      TEXT NOT NULL DEFAULT '{}'
                    CHECK (json_valid(input_json)),
    dedupe_key      TEXT,
    run_id          TEXT,
    queued_at       TEXT,
    started_at      TEXT,
    finished_at     TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedupe
    ON tasks (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_session_status
    ON tasks (session_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_source
    ON tasks (source_type, source_ref);

-- ============================================================
-- Agent Runs
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_runs (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL,
    task_id             TEXT,
    agent_type          TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','starting','running','waiting_permission','compacting','stopping','succeeded','failed','cancelled','overflowed')),
    launch_spec_json    TEXT NOT NULL DEFAULT '{}'
                        CHECK (json_valid(launch_spec_json)),
    pid                 INTEGER,
    context_pack_id     TEXT,
    first_global_seq    INTEGER,
    last_global_seq     INTEGER,
    heartbeat_at        TEXT,
    started_at          TEXT,
    stopped_at          TEXT,
    exit_code           INTEGER,
    stop_reason         TEXT,
    error_class         TEXT,
    runtime_kind        TEXT NOT NULL DEFAULT 'acp'
                        CHECK (runtime_kind IN ('cli','acp')),
    external_session_id TEXT,
    checkpoint_id       TEXT,
    protocol_state_json TEXT NOT NULL DEFAULT '{}'
                        CHECK (json_valid(protocol_state_json)),
    cancel_state        TEXT
                        CHECK (cancel_state IS NULL OR cancel_state IN ('requested','acknowledged','killed')),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

-- ============================================================
-- Events (append-only log)
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
    global_seq      INTEGER PRIMARY KEY AUTOINCREMENT,
    id              TEXT NOT NULL UNIQUE,
    session_id      TEXT NOT NULL,
    run_id          TEXT,
    task_id         TEXT,
    run_seq         INTEGER,
    type            TEXT NOT NULL,
    payload_json    TEXT NOT NULL DEFAULT '{}'
                    CHECK (json_valid(payload_json)),
    schema_version  INTEGER NOT NULL DEFAULT 1,
    causation_id    TEXT,
    correlation_id  TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_session_seq
    ON events (session_id, global_seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_run_seq
    ON events (run_id, run_seq) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_type_seq
    ON events (type, global_seq);

-- ============================================================
-- Messages (denormalized read model)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    run_id          TEXT,
    role            TEXT NOT NULL
                    CHECK (role IN ('user','assistant','system','tool')),
    content         TEXT NOT NULL DEFAULT '',
    metadata_json   TEXT NOT NULL DEFAULT '{}'
                    CHECK (json_valid(metadata_json)),
    source_event_id TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

-- ============================================================
-- Outbox (transactional delivery queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS outbox (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL,
    event_id            TEXT,
    event_global_seq    INTEGER,
    channel_type        TEXT NOT NULL
                        CHECK (channel_type IN ('web','feishu','qq','telegram','discord')),
    target_ref          TEXT NOT NULL,
    kind                TEXT NOT NULL
                        CHECK (kind IN ('web_event','feishu_markdown','qq_markdown','telegram_markdown','discord_markdown')),
    view_model_json     TEXT NOT NULL DEFAULT '{}'
                        CHECK (json_valid(view_model_json)),
    idempotency_key     TEXT NOT NULL UNIQUE,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sending','sent','failed','dead')),
    attempts            INTEGER NOT NULL DEFAULT 0,
    max_attempts        INTEGER NOT NULL DEFAULT 5,
    next_attempt_at     TEXT,
    locked_by           TEXT,
    locked_at           TEXT,
    lease_expires_at    TEXT,
    provider_message_id TEXT,
    last_error          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    sent_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_next
    ON outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_session_created
    ON outbox (session_id, created_at);

-- ============================================================
-- Channel Configs (key-value per channel_id)
-- ============================================================
CREATE TABLE IF NOT EXISTS channel_configs (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL,
    UNIQUE (channel_id, key)
);

-- ============================================================
-- Agent Defaults (scoped config)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_defaults (
    id          TEXT PRIMARY KEY,
    scope_type  TEXT NOT NULL
                CHECK (scope_type IN ('user','channel','workspace','system')),
    scope_ref   TEXT NOT NULL,
    agent_type  TEXT NOT NULL,
    params_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(params_json)),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (scope_type, scope_ref)
);

-- ============================================================
-- Audit Logs
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id              TEXT PRIMARY KEY,
    actor_type      TEXT NOT NULL
                    CHECK (actor_type IN ('web_user','feishu_user','qq_user','telegram_user','discord_user','system','agent')),
    actor_ref       TEXT,
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     TEXT,
    payload_json    TEXT NOT NULL DEFAULT '{}'
                    CHECK (json_valid(payload_json)),
    created_at      TEXT NOT NULL
);

-- ============================================================
-- Permission Requests (ACP protocol)
-- ============================================================
CREATE TABLE IF NOT EXISTS permission_requests (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL,
    run_id              TEXT NOT NULL,
    task_id             TEXT,
    event_id            TEXT,
    acp_request_id      TEXT,
    protocol            TEXT NOT NULL DEFAULT 'acp'
                        CHECK (protocol IN ('acp','legacy_cli')),
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','denied','cancelled','expired')),
    prompt              TEXT NOT NULL DEFAULT '',
    options_json        TEXT NOT NULL DEFAULT '[]'
                        CHECK (json_valid(options_json)),
    tool_call_json      TEXT NOT NULL DEFAULT '{}'
                        CHECK (json_valid(tool_call_json)),
    selected_option_id  TEXT,
    expires_at          TEXT,
    resolved_at         TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE (run_id, acp_request_id)
);

-- ============================================================
-- Schedules (cron + one-shot)
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','cancelled')),
    kind            TEXT NOT NULL
                    CHECK (kind IN ('once','cron')),
    cron_expr       TEXT,
    run_at          TEXT,
    timezone        TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    payload_json    TEXT NOT NULL DEFAULT '{}'
                    CHECK (json_valid(payload_json)),
    next_run_at     TEXT,
    locked_by       TEXT,
    locked_at       TEXT,
    lease_expires_at TEXT,
    last_run_at     TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedules_status_next
    ON schedules (status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_schedules_session
    ON schedules (session_id);

-- ============================================================
-- Context Budgets
-- ============================================================
CREATE TABLE IF NOT EXISTS context_budgets (
    session_id                 TEXT PRIMARY KEY,
    status                     TEXT NOT NULL DEFAULT 'healthy',
    token_estimate             INTEGER NOT NULL DEFAULT 0,
    budget_tokens              INTEGER NOT NULL,
    usage_ratio                REAL NOT NULL DEFAULT 0,
    warning_threshold          REAL NOT NULL DEFAULT 0.70,
    critical_threshold         REAL NOT NULL DEFAULT 0.85,
    overflow_threshold         REAL NOT NULL DEFAULT 0.95,
    source_event_start_id      TEXT,
    source_event_end_id        TEXT,
    source_global_seq          INTEGER NOT NULL DEFAULT 0,
    current_context_pack_id    TEXT,
    last_compacted_at          TEXT,
    overflow_reason            TEXT,
    updated_at                 TEXT NOT NULL
);

-- ============================================================
-- Context Packs
-- ============================================================
CREATE TABLE IF NOT EXISTS context_packs (
    id                      TEXT PRIMARY KEY,
    session_id              TEXT NOT NULL,
    source_run_id           TEXT,
    schema_version          INTEGER NOT NULL DEFAULT 1,
    status                  TEXT NOT NULL DEFAULT 'draft',
    source_event_start_id   TEXT NOT NULL,
    source_event_end_id     TEXT NOT NULL,
    token_estimate          INTEGER,
    summary_json            TEXT NOT NULL DEFAULT '{}'
                            CHECK (json_valid(summary_json)),
    recent_messages_json    TEXT NOT NULL DEFAULT '[]'
                            CHECK (json_valid(recent_messages_json)),
    key_files_json          TEXT NOT NULL DEFAULT '[]'
                            CHECK (json_valid(key_files_json)),
    open_tasks_json         TEXT NOT NULL DEFAULT '[]'
                            CHECK (json_valid(open_tasks_json)),
    created_by              TEXT NOT NULL,
    strategy                TEXT NOT NULL
                            CHECK (strategy IN ('native_compact','miniagent_summary','manual')),
    created_at              TEXT NOT NULL
);

-- ============================================================
-- Memory Archives
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_archives (
    id                        TEXT PRIMARY KEY,
    session_id                TEXT NOT NULL,
    archive_date              TEXT NOT NULL,
    source_event_start_id     TEXT NOT NULL,
    source_event_end_id       TEXT NOT NULL,
    source_global_seq_start   INTEGER NOT NULL,
    source_global_seq_end     INTEGER NOT NULL,
    raw_events_json           TEXT NOT NULL DEFAULT '[]'
                              CHECK (json_valid(raw_events_json)),
    summary_json              TEXT NOT NULL DEFAULT '{}'
                              CHECK (json_valid(summary_json)),
    created_at                TEXT NOT NULL,
    updated_at                TEXT NOT NULL,
    UNIQUE (session_id, archive_date)
);

-- ============================================================
-- Operation Confirmations (two-step dangerous ops)
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_confirmations (
    id              TEXT PRIMARY KEY,
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     TEXT,
    risk_level      TEXT NOT NULL
                    CHECK (risk_level IN ('medium','high','critical')),
    prompt          TEXT NOT NULL,
    payload_json    TEXT NOT NULL DEFAULT '{}'
                    CHECK (json_valid(payload_json)),
    token_hash      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    actor_type      TEXT NOT NULL
                    CHECK (actor_type IN ('web_user','feishu_user','qq_user','telegram_user','discord_user','system','agent')),
    actor_ref       TEXT,
    requested_at    TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    confirmed_at    TEXT,
    consumed_at     TEXT
);
