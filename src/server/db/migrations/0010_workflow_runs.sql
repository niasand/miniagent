-- 0010_workflow_runs.sql
-- DAG workflow engine: run-level projection for the workflow orchestrator.
-- Workflow facts live in the events table (type = wf.*); this table holds the
-- run-level aggregate state (status, current gate, error) for HTTP listing and
-- the reconciler tick scan that recovers runs left waiting on a gate after a restart.
CREATE TABLE IF NOT EXISTS workflow_runs (
    id                TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL,
    definition_json   TEXT NOT NULL CHECK (json_valid(definition_json)),
    status            TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','waiting_gate','succeeded','failed','cancelled')),
    current_gate_node TEXT,
    started_at        TEXT NOT NULL,
    finished_at       TEXT,
    error_node        TEXT,
    error_reason      TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_session ON workflow_runs (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status  ON workflow_runs (status, updated_at);
