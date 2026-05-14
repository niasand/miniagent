import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type SqliteDatabase } from "../../src/server/db/migrate.js";

describe("SQLite schema", () => {
  let db: SqliteDatabase;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "miniagent-db-"));
    db = openDatabase(join(tempDir, "miniagent.sqlite"));
    migrate(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates the core tables and default agent profiles", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "schema_migrations",
        "agent_profiles",
        "agent_defaults",
        "sessions",
        "tasks",
        "agent_runs",
        "events",
        "outbox",
        "projector_offsets",
        "messages",
        "context_budgets",
        "context_packs",
        "schedules",
        "audit_logs",
        "memory_archives",
        "operation_confirmations",
      ]),
    );

    const profiles = db
      .prepare("SELECT id FROM agent_profiles ORDER BY id")
      .all()
      .map((row) => (row as { id: string }).id);

    expect(profiles).toEqual(["claude", "codex", "trae"]);
  });

  it("enables required SQLite pragmas", () => {
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(db.pragma("synchronous", { simple: true })).toBe(1);
  });

  it("uses events.global_seq as a monotonic replay cursor", () => {
    insertActiveRun(db);

    const first = insertEvent(db, "event-1", 1);
    const second = insertEvent(db, "event-2", 2);

    expect(first.global_seq).toBeGreaterThan(0);
    expect(second.global_seq).toBe(first.global_seq + 1);
    expect(() => insertEvent(db, "event-duplicate-run-seq", 2)).toThrow();
  });

  it("enforces one active run per session", () => {
    insertActiveRun(db);

    expect(() => {
      db.prepare(
        `
        INSERT INTO agent_runs (id, session_id, task_id, agent_type, status, launch_spec_json)
        VALUES ('run-2', 'session-1', 'task-1', 'codex', 'queued', '{}')
      `,
      ).run();
    }).toThrow();

    db.prepare("UPDATE agent_runs SET status = 'succeeded' WHERE id = 'run-1'").run();
    db.prepare("UPDATE sessions SET status = 'idle', active_run_id = NULL WHERE id = 'session-1'").run();

    expect(() => {
      db.prepare(
        `
        INSERT INTO agent_runs (id, session_id, task_id, agent_type, status, launch_spec_json)
        VALUES ('run-2', 'session-1', 'task-1', 'codex', 'queued', '{}')
      `,
      ).run();
    }).not.toThrow();
  });

  it("keeps Outbox idempotency and lease fields available", () => {
    insertActiveRun(db);
    const event = insertEvent(db, "event-1", 1);

    db.prepare(
      `
      INSERT INTO outbox (
        id, session_id, event_id, event_global_seq, channel_type, target_ref, kind,
        view_model_json, idempotency_key, status, locked_by, locked_at, lease_expires_at
      )
      VALUES (
        'outbox-1', 'session-1', 'event-1', ?, 'web', 'connection-1', 'web_event',
        '{}', 'web:event-1', 'sending', 'worker-1',
        '2026-05-13T00:00:00.000Z', '2026-05-13T00:00:30.000Z'
      )
    `,
    ).run(event.global_seq);

    expect(() => {
      db.prepare(
        `
        INSERT INTO outbox (
          id, session_id, event_id, event_global_seq, channel_type, target_ref, kind,
          view_model_json, idempotency_key
        )
        VALUES ('outbox-2', 'session-1', 'event-1', ?, 'web', 'connection-1', 'web_event', '{}', 'web:event-1')
      `,
      ).run(event.global_seq);
    }).toThrow();

    const row = db
      .prepare("SELECT locked_by, lease_expires_at, attempts, max_attempts FROM outbox WHERE id = 'outbox-1'")
      .get() as { locked_by: string; lease_expires_at: string; attempts: number; max_attempts: number };

    expect(row).toEqual({
      locked_by: "worker-1",
      lease_expires_at: "2026-05-13T00:00:30.000Z",
      attempts: 0,
      max_attempts: 5,
    });
  });

  it("keeps Scheduler lease fields available", () => {
    insertActiveRun(db);

    db.prepare(
      `
      INSERT INTO schedules (
        id, session_id, status, kind, run_at, timezone, payload_json, next_run_at,
        locked_by, locked_at, lease_expires_at, last_run_at
      )
      VALUES (
        'schedule-1', 'session-1', 'active', 'once', '2026-05-13T00:00:00.000Z',
        'Asia/Shanghai', '{}', '2026-05-13T00:00:00.000Z',
        'worker-1', '2026-05-13T00:00:00.000Z', '2026-05-13T00:00:30.000Z',
        '2026-05-13T00:00:00.000Z'
      )
    `,
    ).run();

    const row = db
      .prepare("SELECT locked_by, lease_expires_at, last_run_at FROM schedules WHERE id = 'schedule-1'")
      .get() as { locked_by: string; lease_expires_at: string; last_run_at: string };

    expect(row).toEqual({
      locked_by: "worker-1",
      lease_expires_at: "2026-05-13T00:00:30.000Z",
      last_run_at: "2026-05-13T00:00:00.000Z",
    });
  });

  it("stores projector replay offsets by global sequence", () => {
    insertActiveRun(db);
    const event = insertEvent(db, "event-1", 1);

    db.prepare("INSERT INTO projector_offsets (projector_name) VALUES ('messages')").run();

    const initial = db
      .prepare("SELECT last_global_seq FROM projector_offsets WHERE projector_name = 'messages'")
      .get() as { last_global_seq: number };
    expect(initial.last_global_seq).toBe(0);

    db.prepare(
      `
      UPDATE projector_offsets
      SET last_global_seq = ?, last_event_id = 'event-1'
      WHERE projector_name = 'messages'
    `,
    ).run(event.global_seq);

    const updated = db
      .prepare("SELECT last_global_seq, last_event_id FROM projector_offsets WHERE projector_name = 'messages'")
      .get() as { last_global_seq: number; last_event_id: string };
    expect(updated).toEqual({ last_global_seq: event.global_seq, last_event_id: "event-1" });
  });

  it("does not reapply an already recorded migration", () => {
    migrate(db);

    const rows = db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: string }).version);

    expect(rows).toEqual([
      "0001_initial",
      "0002_context_budgets",
      "0003_schedule_leases",
      "0004_memory_archives",
      "0005_operation_confirmations",
    ]);
  });
});

function insertActiveRun(db: SqliteDatabase): void {
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

function insertEvent(db: SqliteDatabase, id: string, runSeq: number): { global_seq: number } {
  return db
    .prepare(
      `
      INSERT INTO events (id, session_id, run_id, task_id, run_seq, type, payload_json)
      VALUES (?, 'session-1', 'run-1', 'task-1', ?, 'text_delta', '{"text":"hello"}')
      RETURNING global_seq
    `,
    )
    .get(id, runSeq) as { global_seq: number };
}
