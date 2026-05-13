import type { SqliteDatabase } from "../../src/server/db/migrate.js";

export function insertActiveRunFixture(db: SqliteDatabase): void {
  db.prepare(
    `
    INSERT INTO sessions (id, title, agent_type, workspace_path, status)
    VALUES ('session-1', 'Test session', 'codex', '/tmp/miniagent-test', 'running')
  `,
  ).run();

  db.prepare(
    `
    INSERT INTO tasks (
      id, session_id, source_type, type, status, target_agent_type, input_json
    )
    VALUES ('task-1', 'session-1', 'web', 'message', 'running', 'codex', '{}')
  `,
  ).run();

  db.prepare(
    `
    INSERT INTO agent_runs (id, session_id, task_id, agent_type, status, launch_spec_json)
    VALUES ('run-1', 'session-1', 'task-1', 'codex', 'running', '{}')
  `,
  ).run();

  db.prepare("UPDATE tasks SET run_id = 'run-1' WHERE id = 'task-1'").run();
  db.prepare("UPDATE sessions SET active_run_id = 'run-1' WHERE id = 'session-1'").run();
}
