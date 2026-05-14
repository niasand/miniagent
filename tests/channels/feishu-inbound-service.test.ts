import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/server/events/event-store.js";
import { FeishuInboundService } from "../../src/server/channels/feishu-inbound-service.js";
import { WorkspacePolicy } from "../../src/server/security/workspace-policy.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("FeishuInboundService", () => {
  let testDb: TestDatabase;
  let events: EventStore;
  let sessions: SessionStore;
  let service: FeishuInboundService;

  beforeEach(() => {
    testDb = createTestDatabase();
    events = new EventStore(testDb.db);
    sessions = new SessionStore(testDb.db, events);
    service = new FeishuInboundService(testDb.db, events, {
      workspacePolicy: new WorkspacePolicy(["/tmp", process.cwd()]),
    });
  });

  afterEach(() => {
    testDb.close();
  });

  it("creates a Feishu session and deduped message task from chat input", () => {
    const selected = service.receiveMessage({
      messageId: "msg-use",
      chatId: "chat-1",
      userId: "user-1",
      text: "/agent use claude",
    });
    const first = service.receiveMessage({
      messageId: "msg-1",
      chatId: "chat-1",
      userId: "user-1",
      text: "Build the Feishu adapter",
      workspacePath: "/tmp/miniagent-test",
    });
    const second = service.receiveMessage({
      messageId: "msg-1",
      chatId: "chat-1",
      userId: "user-1",
      text: "Build the Feishu adapter",
      workspacePath: "/tmp/miniagent-test",
    });

    expect(first).toMatchObject({
      action: "message",
      session: {
        channelType: "feishu",
        channelRef: "chat-1",
        agentType: "claude",
      },
      task: {
        sourceType: "feishu",
        sourceRef: "msg-1",
        type: "message",
        dedupeKey: "feishu:msg-1",
      },
    });
    expect(selected).toMatchObject({
      action: "agent_use",
      scopeType: "user",
      scopeRef: "user-1",
      agentType: "claude",
    });
    expect(second).toMatchObject({
      action: "message",
      task: { id: first.action === "message" ? first.task.id : "" },
    });
    expect(countRows("sessions")).toBe(1);
    expect(countRows("tasks")).toBe(1);
  });

  it("handles agent commands for new sessions and handoff", () => {
    const created = service.receiveMessage({
      messageId: "msg-new",
      chatId: "chat-1",
      userId: "user-1",
      text: "/agent new claude /tmp/project",
    });

    expect(created).toMatchObject({
      action: "agent_new",
      session: {
        agentType: "claude",
        workspacePath: "/tmp/project",
        channelType: "feishu",
      },
    });

    const sessionId = created.action === "agent_new" ? created.session.id : "";
    sessions.createTask({
      id: "task-1",
      sessionId,
      sourceType: "feishu",
      sourceRef: "msg-task",
      type: "message",
      input: { text: "Create handoff source history" },
    });
    const handedOff = service.receiveMessage({
      messageId: "msg-handoff",
      chatId: "chat-1",
      userId: "user-1",
      text: "/agent handoff codex",
      sessionId,
    });

    expect(handedOff).toMatchObject({
      action: "handoff",
      sourceSessionId: sessionId,
      targetSessionId: expect.any(String),
      taskId: expect.any(String),
      contextPackId: expect.any(String),
    });
    expect(readAuditActions()).toEqual(expect.arrayContaining(["agent_new", "agent_handoff", "handoff"]));
  });

  it("reports context status for a Feishu session", () => {
    const received = service.receiveMessage({
      messageId: "msg-1",
      chatId: "chat-1",
      text: "Create context status source",
    });
    const sessionId = received.action === "message" ? received.session.id : "";

    const status = service.receiveMessage({
      messageId: "msg-status",
      chatId: "chat-1",
      text: "/context status",
      sessionId,
    });

    expect(status).toMatchObject({
      action: "context_status",
      sessionId,
      status: "healthy",
      tokenEstimate: expect.any(Number),
    });
  });

  it("rejects remote sessions outside the workspace allowlist", () => {
    expect(() =>
      service.receiveMessage({
        messageId: "msg-denied",
        chatId: "chat-1",
        userId: "user-1",
        text: "/agent new codex /etc",
      }),
    ).toThrow("Workspace denied");

    expect(readAuditActions()).toContain("workspace_denied");
  });

  function countRows(table: string): number {
    return (testDb.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  }

  function readAuditActions(): string[] {
    return testDb.db
      .prepare("SELECT action FROM audit_logs ORDER BY created_at ASC, id ASC")
      .all()
      .map((row) => (row as { action: string }).action);
  }
});
