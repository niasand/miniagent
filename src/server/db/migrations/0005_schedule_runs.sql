-- 0005_schedule_runs.sql
-- Persist schedule trigger history independently from task lifecycle.

CREATE TABLE IF NOT EXISTS schedule_runs (
    id              TEXT PRIMARY KEY,
    schedule_id     TEXT NOT NULL,
    session_id      TEXT NOT NULL,
    task_id         TEXT,
    scheduled_for   TEXT,
    status          TEXT NOT NULL
                    CHECK (status IN ('queued','failed')),
    error           TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_created
    ON schedule_runs (schedule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_task
    ON schedule_runs (task_id);
