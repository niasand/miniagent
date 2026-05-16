-- Extend channel_type CHECK constraints to include wechat, wecom, dingtalk

-- SQLite doesn't support ALTER TABLE to modify CHECK constraints.
-- We need to recreate the tables with updated constraints.

PRAGMA foreign_keys = OFF;

-- Recreate sessions table
CREATE TABLE sessions_new (
    id                  TEXT PRIMARY KEY,
    title               TEXT NOT NULL DEFAULT '',
    agent_type          TEXT NOT NULL,
    workspace_path      TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'idle'
                        CHECK (status IN ('idle','running','compacting','failed','archived')),
    channel_type        TEXT
                        CHECK (channel_type IS NULL OR channel_type IN ('web','feishu','qq','telegram','discord','wechat','wecom','dingtalk')),
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

INSERT INTO sessions_new SELECT * FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_status         ON sessions (status);
CREATE INDEX idx_sessions_channel        ON sessions (channel_type, channel_ref);
CREATE INDEX idx_sessions_agent_type     ON sessions (agent_type);

-- Recreate audit_logs table
CREATE TABLE audit_logs_new (
    id            TEXT PRIMARY KEY,
    actor_type    TEXT NOT NULL,
    actor_ref     TEXT,
    action        TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT,
    channel_type  TEXT
                  CHECK (channel_type IS NULL OR channel_type IN ('web','feishu','qq','telegram','discord','wechat','wecom','dingtalk')),
    payload_json  TEXT NOT NULL DEFAULT '{}'
                  CHECK (json_valid(payload_json)),
    created_at    TEXT NOT NULL
);

INSERT INTO audit_logs_new (id, actor_type, actor_ref, action, resource_type, resource_id, payload_json, created_at)
  SELECT id, actor_type, actor_ref, action, resource_type, resource_id, payload_json, created_at FROM audit_logs;
DROP TABLE audit_logs;
ALTER TABLE audit_logs_new RENAME TO audit_logs;

CREATE INDEX idx_audit_logs_actor   ON audit_logs (actor_type, actor_ref);
CREATE INDEX idx_audit_logs_action  ON audit_logs (action);
CREATE INDEX idx_audit_logs_resource ON audit_logs (resource_type, resource_id);

-- Recreate outbox table (exact same columns as original, just extended CHECK constraints)
CREATE TABLE outbox_new (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL,
    event_id            TEXT,
    event_global_seq    INTEGER,
    channel_type        TEXT NOT NULL
                        CHECK (channel_type IN ('web','feishu','qq','telegram','discord','wechat','wecom','dingtalk')),
    target_ref          TEXT NOT NULL,
    kind                TEXT NOT NULL
                        CHECK (kind IN ('web_event','feishu_markdown','qq_markdown','telegram_markdown','discord_markdown','wechat_markdown','wecom_markdown','dingtalk_markdown')),
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

INSERT INTO outbox_new SELECT * FROM outbox;
DROP TABLE outbox;
ALTER TABLE outbox_new RENAME TO outbox;

CREATE INDEX idx_outbox_status      ON outbox (status, next_attempt_at);
CREATE INDEX idx_outbox_session     ON outbox (session_id);

PRAGMA foreign_keys = ON;
