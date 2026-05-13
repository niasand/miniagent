import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("SessionStore", () => {
  let testDb: TestDatabase;
  let sessions: SessionStore;

  beforeEach(() => {
    testDb = createTestDatabase();
    sessions = new SessionStore(testDb.db);
  });

  afterEach(() => {
    testDb.close();
  });

  it("creates sessions with fixed agent type and workspace", () => {
    const session = sessions.createSession({
      id: "session-1",
      title: "Codex session",
      agentType: "codex",
      workspacePath: "/tmp/miniagent-test",
      channelType: "web",
      channelRef: "user-1",
      defaultParams: { profile: "default" },
    });

    expect(session).toMatchObject({
      id: "session-1",
      agentType: "codex",
      workspacePath: "/tmp/miniagent-test",
      status: "idle",
      activeRunId: null,
      defaultParams: { profile: "default" },
    });
  });

  it("creates a task and task_created event in one transaction", () => {
    createSession();

    const result = sessions.createTask({
      id: "task-1",
      sessionId: "session-1",
      sourceType: "web",
      type: "message",
      input: { text: "hello" },
      dedupeKey: "web:message-1",
    });

    expect(result.task).toMatchObject({
      id: "task-1",
      status: "queued",
      input: { text: "hello" },
      dedupeKey: "web:message-1",
    });
    expect(result.event).toMatchObject({
      sessionId: "session-1",
      taskId: "task-1",
      runId: null,
      runSeq: null,
      type: "task_created",
    });
  });

  it("rolls back task creation before appending an event when dedupe fails", () => {
    createSession();
    createTask("task-1", "web:message-1");

    expect(() => createTask("task-2", "web:message-1")).toThrow();

    expect(sessions.getTask("task-2")).toBeNull();
    const eventCount = testDb.db.prepare("SELECT COUNT(*) AS count FROM events").get() as { count: number };
    expect(eventCount.count).toBe(1);
  });

  it("starts a run, updates task/session state, and appends run_started", () => {
    createSession();
    createTask();

    const result = sessions.startRun({
      id: "run-1",
      sessionId: "session-1",
      taskId: "task-1",
      launchSpec: { command: "codex", args: ["--json"] },
      pid: 1234,
      startedAt: "2026-05-13T00:00:00.000Z",
    });

    expect(result.run).toMatchObject({
      id: "run-1",
      status: "running",
      pid: 1234,
      firstGlobalSeq: result.event.globalSeq,
      lastGlobalSeq: result.event.globalSeq,
      launchSpec: { command: "codex", args: ["--json"] },
    });
    expect(result.event).toMatchObject({
      runId: "run-1",
      taskId: "task-1",
      runSeq: 1,
      type: "run_started",
    });
    expect(sessions.getTask("task-1")).toMatchObject({ status: "running", runId: "run-1" });
    expect(sessions.getSession("session-1")).toMatchObject({ status: "running", activeRunId: "run-1" });
  });

  it("blocks a second active run for the same session", () => {
    createSession();
    createTask("task-1");
    createTask("task-2");
    sessions.startRun({ id: "run-1", sessionId: "session-1", taskId: "task-1" });

    expect(() => {
      sessions.startRun({ id: "run-2", sessionId: "session-1", taskId: "task-2" });
    }).toThrow();
    expect(sessions.getRun("run-2")).toBeNull();
    expect(sessions.getTask("task-2")).toMatchObject({ status: "queued", runId: null });
  });

  it("finishes a run after appending the terminal event", () => {
    createSession();
    createTask();
    sessions.startRun({ id: "run-1", sessionId: "session-1", taskId: "task-1" });

    const result = sessions.finishRun({
      runId: "run-1",
      status: "succeeded",
      exitCode: 0,
      stopReason: "completed",
      stoppedAt: "2026-05-13T00:01:00.000Z",
    });

    expect(result.event).toMatchObject({
      runId: "run-1",
      runSeq: 2,
      type: "run_finished",
    });
    expect(result.run).toMatchObject({
      status: "succeeded",
      lastGlobalSeq: result.event.globalSeq,
      exitCode: 0,
      stopReason: "completed",
    });
    expect(sessions.getTask("task-1")).toMatchObject({ status: "succeeded" });
    expect(sessions.getSession("session-1")).toMatchObject({ status: "idle", activeRunId: null });

    expect(() => {
      sessions.finishRun({ runId: "run-1", status: "succeeded" });
    }).toThrow("Run is already terminal");
  });

  it("moves an overflowed run into session compaction state", () => {
    createSession();
    createTask();
    sessions.startRun({ id: "run-1", sessionId: "session-1", taskId: "task-1" });

    const result = sessions.finishRun({
      runId: "run-1",
      status: "overflowed",
      errorClass: "context_overflow",
    });

    expect(result.event.type).toBe("run_failed");
    expect(sessions.getTask("task-1")).toMatchObject({ status: "failed" });
    expect(sessions.getSession("session-1")).toMatchObject({ status: "compacting", activeRunId: null });
  });

  function createSession() {
    return sessions.createSession({
      id: "session-1",
      title: "Codex session",
      agentType: "codex",
      workspacePath: "/tmp/miniagent-test",
    });
  }

  function createTask(id = "task-1", dedupeKey?: string) {
    return sessions.createTask({
      id,
      sessionId: "session-1",
      sourceType: "web",
      type: "message",
      input: { text: id },
      dedupeKey,
    });
  }
});
