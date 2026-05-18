-- Extend source_type CHECK constraint to include wechat, wecom, dingtalk

PRAGMA foreign_keys = OFF;

CREATE TABLE tasks_new (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    source_type     TEXT NOT NULL
                    CHECK (source_type IN ('web','feishu','qq','telegram','discord','wechat','wecom','dingtalk','cron','handoff','mcp','system')),
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

INSERT INTO tasks_new SELECT * FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE UNIQUE INDEX idx_tasks_dedupe
    ON tasks (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_tasks_session_status
    ON tasks (session_id, status);
CREATE INDEX idx_tasks_source
    ON tasks (source_type, source_ref);

PRAGMA foreign_keys = ON;
