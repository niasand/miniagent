-- 0006_schedule_run_payload_summary.sql
-- Keep a small snapshot of what each schedule run queued.

ALTER TABLE schedule_runs ADD COLUMN payload_summary TEXT;
