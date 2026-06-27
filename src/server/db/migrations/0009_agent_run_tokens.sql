-- 0009_agent_run_tokens.sql
-- Persist real token usage per agent run.
-- ACP driver already extracts usage from session/prompt responses and the supervisor
-- accumulates it on the in-memory ActiveRun; finishRun now writes the totals here so
-- token usage survives restarts and feeds cost/insight views.
ALTER TABLE agent_runs ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
