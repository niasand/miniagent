import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLogStore } from "../../src/server/audit/audit-log-store.js";
import { ContextPackService } from "../../src/server/context/context-pack-service.js";
import { ContextPackStore } from "../../src/server/context/context-pack-store.js";
import { EventStore } from "../../src/server/events/event-store.js";
import { HandoffService } from "../../src/server/handoff/handoff-service.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("HandoffService", () => {
  let testDb: TestDatabase;
  let auditLogs: AuditLogStore;
  let contextPacks: ContextPackStore;
  let eventStore: EventStore;
  let handoff: HandoffService;
  let sessions: SessionStore;

  beforeEach(() => {
    testDb = createTestDatabase();
    eventStore = new EventStore(testDb.db);
    sessions = new SessionStore(testDb.db, eventStore);
    contextPacks = new ContextPackStore(testDb.db);
    auditLogs = new AuditLogStore(testDb.db);
    handoff = new HandoffService(testDb.db, eventStore);
    createSourceSession();
  });

  afterEach(() => {
    testDb.close();
  });

  it("creates a new target session from a generated ContextPack", () => {
    const result = handoff.handoff({
      sourceSessionId: "session-source",
      targetAgentType: "claude",
      actorType: "web_user",
      actorRef: "user-1",
      createdAt: "2026-05-13T00:10:00.000Z",
    });

    expect(result.sourceSession).toMatchObject({
      id: "session-source",
      agentType: "codex",
    });
    expect(sessions.getSession("session-source")).toMatchObject({
      agentType: "codex",
      sourceSessionId: null,
    });
    expect(result.targetSession).toMatchObject({
      agentType: "claude",
      workspacePath: "/tmp/miniagent-test",
      sourceSessionId: "session-source",
      sourceContextPackId: result.contextPack.id,
    });
    expect(result.task).toMatchObject({
      sessionId: result.targetSession.id,
      sourceType: "handoff",
      type: "handoff",
      targetAgentType: "claude",
      status: "queued",
    });
    expect(result.requestedEvent).toMatchObject({
      sessionId: "session-source",
      type: "handoff_requested",
    });
    expect(result.createdEvent).toMatchObject({
      sessionId: "session-source",
      type: "handoff_created",
      causationId: result.requestedEvent.id,
      payload: {
        targetSessionId: result.targetSession.id,
        sourceContextPackId: result.contextPack.id,
        targetAgentType: "claude",
      },
    });
    expect(contextPacks.get(result.contextPack.id)).toMatchObject({
      status: "ready",
      sessionId: "session-source",
    });
    expect(auditLogs.listByResource("session", "session-source")).toEqual([
      expect.objectContaining({
        actorType: "web_user",
        actorRef: "user-1",
        action: "handoff",
        payload: expect.objectContaining({
          targetSessionId: result.targetSession.id,
          sourceContextPackId: result.contextPack.id,
        }),
      }),
    ]);
  });

  it("reuses the latest ready ContextPack instead of creating another one", () => {
    const existing = new ContextPackService(testDb.db, eventStore).createFromEvents({
      id: "ctx-existing",
      sessionId: "session-source",
      createdBy: "system",
      createdAt: "2026-05-13T00:05:00.000Z",
    }).contextPack;

    const result = handoff.handoff({
      sourceSessionId: "session-source",
      targetAgentType: "trae",
      actorType: "system",
      createdAt: "2026-05-13T00:10:00.000Z",
    });

    expect(result.contextPack.id).toBe(existing.id);
    expect(result.targetSession).toMatchObject({
      agentType: "trae",
      sourceContextPackId: "ctx-existing",
    });

    const packCount = testDb.db.prepare("SELECT COUNT(*) AS count FROM context_packs").get() as { count: number };
    expect(packCount.count).toBe(1);
  });

  it("rolls back target session, task, events, and audit log when target agent is invalid", () => {
    expect(() => {
      handoff.handoff({
        sourceSessionId: "session-source",
        targetAgentType: "codex",
        actorType: "web_user",
      });
    }).toThrow("Handoff target agent must differ from source session agent");

    const sessionCount = testDb.db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number };
    const auditCount = testDb.db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get() as { count: number };
    const handoffEvents = eventStore
      .listAfterGlobalSeq({ sessionId: "session-source", afterGlobalSeq: 0 })
      .filter((event) => event.type.startsWith("handoff_"));

    expect(sessionCount.count).toBe(1);
    expect(auditCount.count).toBe(0);
    expect(handoffEvents).toEqual([]);
  });

  function createSourceSession(): void {
    sessions.createSession({
      id: "session-source",
      title: "Codex source",
      agentType: "codex",
      workspacePath: "/tmp/miniagent-test",
      channelType: "web",
      channelRef: "user-1",
      defaultParams: { args: ["--json"] },
    });
    sessions.createTask({
      id: "task-source",
      sessionId: "session-source",
      sourceType: "web",
      type: "message",
      input: { text: "Continue implementation" },
    });
    sessions.startRun({ id: "run-source", sessionId: "session-source", taskId: "task-source" });
    eventStore.append({
      id: "event-source-text",
      sessionId: "session-source",
      runId: "run-source",
      taskId: "task-source",
      type: "text_delta",
      payload: { text: "Context ready." },
    });
    sessions.finishRun({ runId: "run-source", status: "succeeded" });
  }
});
