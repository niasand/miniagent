ALTER TABLE schedules ADD COLUMN locked_by TEXT;
ALTER TABLE schedules ADD COLUMN locked_at TEXT;
ALTER TABLE schedules ADD COLUMN lease_expires_at TEXT;
ALTER TABLE schedules ADD COLUMN last_run_at TEXT;

CREATE INDEX idx_schedules_lease ON schedules(status, lease_expires_at);
