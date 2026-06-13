CREATE TABLE IF NOT EXISTS notification_preferences (
    id              TEXT PRIMARY KEY,
    scope_type      TEXT NOT NULL
                    CHECK (scope_type IN ('user','system')),
    scope_ref       TEXT NOT NULL,
    targets_json    TEXT NOT NULL DEFAULT '[]'
                    CHECK (json_valid(targets_json)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (scope_type, scope_ref)
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_scope
    ON notification_preferences (scope_type, scope_ref);
