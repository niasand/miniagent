import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/server/events/event-store.js";
import { ControlToolService } from "../../src/server/mcp/control-tool-service.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("ControlToolService", () => {
  let testDb: TestDatabase;
  let events: EventStore;
  let sessions: SessionStore;
  let service: ControlToolService;

  beforeEach(() => {
    testDb = createTestDatabase();
    events = new EventStore(testDb.db);
    sessions = new SessionStore(testDb.db, events);
    service = new ControlToolService(testDb.db);
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
      input: { text: "hello" },
    });
    events.append({
      id: "event-text",
      sessionId: "session-1",
      type: "text_delta",
      payload: { text: "hello" },
    });
  });

  afterEach(() => {
    testDb.close();
  });

  it("lists minimal control tools", () => {
    expect(service.listTools().map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "session.list",
        "session.status",
        "events.query",
        "outbox.status",
        "context.status",
        "context.compact",
        "schedule.create",
        "schedule.pause",
        "schedule.resume",
        "schedule.cancel",
      ]),
    );
  });

  it("calls session, event, context, and schedule tools", () => {
    expect(service.callTool("session.status", { sessionId: "session-1" })).toMatchObject({
      name: "session.status",
      result: {
        session: { id: "session-1" },
        nextQueuedTask: { id: "task-1" },
      },
    });
    expect(service.callTool("events.query", { sessionId: "session-1", afterGlobalSeq: 0, limit: 10 })).toMatchObject({
      name: "events.query",
      result: expect.arrayContaining([expect.objectContaining({ id: "event-text" })]),
    });
    expect(service.callTool("context.status", { sessionId: "session-1" })).toMatchObject({
      name: "context.status",
      result: { sessionId: "session-1", status: "healthy" },
    });

    const created = service.callTool("schedule.create", {
      sessionId: "session-1",
      kind: "once",
      runAt: "2026-05-14T12:00:00.000Z",
      payload: { input: { text: "scheduled" } },
    }) as { result: { id: string } };
    expect(created).toMatchObject({
      name: "schedule.create",
      result: { sessionId: "session-1", kind: "once", status: "active" },
    });
    expect(service.callTool("schedule.pause", { scheduleId: created.result.id })).toMatchObject({
      name: "schedule.pause",
      result: { id: created.result.id, status: "paused" },
    });
  });

  it("rejects unknown tools and invalid args", () => {
    expect(() => service.callTool("missing.tool", {})).toThrow("Unknown control tool");
    expect(() => service.callTool("session.status", {})).toThrow("sessionId is required");
  });
});
