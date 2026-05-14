import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextRestartService } from "../../src/server/context/context-restart-service.js";
import { EventStore } from "../../src/server/events/event-store.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("ContextRestartService", () => {
  let testDb: TestDatabase;
  let events: EventStore;
  let sessions: SessionStore;
  let service: ContextRestartService;

  beforeEach(() => {
    testDb = createTestDatabase();
    events = new EventStore(testDb.db);
    sessions = new SessionStore(testDb.db, events);
    service = new ContextRestartService(testDb.db, events);
    sessions.createSession({
      id: "session-1",
      title: "Codex session",
      agentType: "codex",
      workspacePath: "/tmp/miniagent-test",
    });
    sessions.createTask({
      id: "task-1",
      sessionId: "session-1",
      sourceType: "web",
      type: "message",
      input: { text: "Build the restart path" },
    });
    events.append({
      id: "event-text",
      sessionId: "session-1",
      type: "text_delta",
      payload: { text: "Created a ContextPack." },
    });
  });

  afterEach(() => {
    testDb.close();
  });

  it("creates a ready ContextPack and queues a resume task", () => {
    const result = service.restart({
      sessionId: "session-1",
      actorType: "web_user",
      actorRef: "user-1",
      requestedAt: "2026-05-14T00:00:00.000Z",
    });

    expect(result.contextPack).toMatchObject({
      sessionId: "session-1",
      status: "ready",
    });
    expect(result.task).toMatchObject({
      sessionId: "session-1",
      sourceType: "system",
      type: "resume",
      targetAgentType: "codex",
      input: {
        contextPackId: result.contextPack.id,
      },
    });
    expect(result.event).toMatchObject({
      type: "context_restart_requested",
      payload: {
        contextPackId: result.contextPack.id,
        taskId: result.task.id,
      },
    });
    expect(readAuditActions()).toContain("context_restart");
  });

  it("rejects active sessions", () => {
    sessions.startRun({ id: "run-1", sessionId: "session-1", taskId: "task-1" });

    expect(() =>
      service.restart({
        sessionId: "session-1",
        actorType: "web_user",
      }),
    ).toThrow("active run");
  });

  function readAuditActions(): string[] {
    return testDb.db
      .prepare("SELECT action FROM audit_logs ORDER BY created_at ASC, id ASC")
      .all()
      .map((row) => (row as { action: string }).action);
  }
});
