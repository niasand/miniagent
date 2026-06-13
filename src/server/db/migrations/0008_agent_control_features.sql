-- Persistent goals, delegation records, and searchable message memory.

CREATE TABLE IF NOT EXISTS agent_goals (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL UNIQUE,
    objective       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','completed','cleared')),
    turn_count      INTEGER NOT NULL DEFAULT 0,
    max_turns       INTEGER NOT NULL DEFAULT 20,
    subgoals_json   TEXT NOT NULL DEFAULT '[]'
                    CHECK (json_valid(subgoals_json)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_goals_status
    ON agent_goals (status, updated_at);

CREATE TABLE IF NOT EXISTS agent_delegations (
    id                  TEXT PRIMARY KEY,
    parent_session_id   TEXT NOT NULL,
    child_session_id    TEXT NOT NULL,
    child_task_id       TEXT NOT NULL,
    goal                TEXT NOT NULL,
    context             TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_delegations_parent
    ON agent_delegations (parent_session_id, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    session_id UNINDEXED,
    role UNINDEXED,
    message_id UNINDEXED,
    created_at UNINDEXED
);

INSERT INTO messages_fts(rowid, content, session_id, role, message_id, created_at)
SELECT rowid, content, session_id, role, id, created_at
FROM messages
WHERE rowid NOT IN (SELECT rowid FROM messages_fts);

CREATE TRIGGER IF NOT EXISTS messages_ai_fts AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content, session_id, role, message_id, created_at)
  VALUES (new.rowid, new.content, new.session_id, new.role, new.id, new.created_at);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad_fts AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role, message_id, created_at)
  VALUES ('delete', old.rowid, old.content, old.session_id, old.role, old.id, old.created_at);
END;

CREATE TRIGGER IF NOT EXISTS messages_au_fts AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role, message_id, created_at)
  VALUES ('delete', old.rowid, old.content, old.session_id, old.role, old.id, old.created_at);
  INSERT INTO messages_fts(rowid, content, session_id, role, message_id, created_at)
  VALUES (new.rowid, new.content, new.session_id, new.role, new.id, new.created_at);
END;
