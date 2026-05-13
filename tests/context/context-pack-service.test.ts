import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextPackService } from "../../src/server/context/context-pack-service.js";
import { ContextPackStore } from "../../src/server/context/context-pack-store.js";
import { EventStore } from "../../src/server/events/event-store.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("ContextPackService", () => {
  let testDb: TestDatabase;
  let eventStore: EventStore;
  let sessionStore: SessionStore;
  let contextPacks: ContextPackStore;
  let service: ContextPackService;

  beforeEach(() => {
    testDb = createTestDatabase();
    eventStore = new EventStore(testDb.db);
    sessionStore = new SessionStore(testDb.db, eventStore);
    contextPacks = new ContextPackStore(testDb.db);
    service = new ContextPackService(testDb.db, eventStore);
    createEventHistory();
  });

  afterEach(() => {
    testDb.close();
  });

  it("creates a ready ContextPack from an EventStore range and updates the session", () => {
    const result = service.createFromEvents({
      id: "ctx-1",
      sessionId: "session-1",
      sourceEventStartId: "event-task",
      sourceEventEndId: "event-stderr",
      createdBy: "system",
      createdAt: "2026-05-13T00:05:00.000Z",
    });

    expect(result.contextPack).toMatchObject({
      id: "ctx-1",
      sessionId: "session-1",
      sourceRunId: "run-1",
      status: "ready",
      sourceEventStartId: "event-task",
      sourceEventEndId: "event-stderr",
      createdBy: "system",
      strategy: "miniagent_summary",
    });
    expect(result.contextPack.tokenEstimate).toBeGreaterThan(0);
    expect(result.contextPack.summary).toMatchObject({
      goal: "Build the migration",
      sourceEventRange: {
        start: "event-task",
        end: "event-stderr",
        count: 4,
      },
    });
    expect(result.contextPack.recentMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "Build the migration" }),
        expect.objectContaining({ role: "assistant", content: "Created schema." }),
        expect.objectContaining({ role: "tool", content: "warning: slow query" }),
      ]),
    );
    expect(result.contextPack.keyFiles).toEqual(expect.arrayContaining([expect.objectContaining({ path: "src/db.ts" })]));
    expect(result.contextPack.openTasks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "task-followup", status: "queued" })]),
    );

    expect(sessionStore.getSession("session-1")).toMatchObject({
      currentContextPackId: "ctx-1",
    });
    expect(contextPacks.getLatestReady("session-1")).toMatchObject({ id: "ctx-1" });
    expect(result.event).toMatchObject({
      type: "context_pack_created",
      runId: null,
      runSeq: null,
      payload: {
        contextPackId: "ctx-1",
        sourceRunId: "run-1",
        sourceEventStartId: "event-task",
        sourceEventEndId: "event-stderr",
      },
    });
  });

  it("does not delete raw events or messages when compacting", () => {
    const before = countRows("events");

    service.createFromEvents({
      id: "ctx-1",
      sessionId: "session-1",
      createdBy: "user",
    });

    expect(countRows("events")).toBe(before + 1);
    expect(eventStore.listAfterGlobalSeq({ sessionId: "session-1", afterGlobalSeq: 0 })).toHaveLength(before + 1);
  });

  it("rolls back session pointer and event append when the source range is invalid", () => {
    expect(() => {
      service.createFromEvents({
        id: "ctx-invalid",
        sessionId: "session-1",
        sourceEventStartId: "event-stderr",
        sourceEventEndId: "event-task",
        createdBy: "system",
      });
    }).toThrow("ContextPack source range is invalid");

    expect(contextPacks.get("ctx-invalid")).toBeNull();
    expect(sessionStore.getSession("session-1")).toMatchObject({ currentContextPackId: null });
    expect(
      eventStore
        .listAfterGlobalSeq({ sessionId: "session-1", afterGlobalSeq: 0 })
        .some((event) => event.type === "context_pack_created"),
    ).toBe(false);
  });

  function createEventHistory(): void {
    sessionStore.createSession({
      id: "session-1",
      title: "Codex session",
      agentType: "codex",
      workspacePath: "/tmp/miniagent-test",
    });
    sessionStore.createTask({
      id: "task-1",
      sessionId: "session-1",
      sourceType: "web",
      type: "message",
      input: { text: "Build the migration" },
    });
    sessionStore.startRun({ id: "run-1", sessionId: "session-1", taskId: "task-1" });

    renameEvent(1, "event-task");
    renameEvent(2, "event-started");

    eventStore.append({
      id: "event-text",
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "text_delta",
      payload: { text: "Created schema.", files: [{ path: "src/db.ts" }] },
    });
    eventStore.append({
      id: "event-stderr",
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "runtime_stderr",
      payload: { text: "warning: slow query" },
    });
    sessionStore.createTask({
      id: "task-followup",
      sessionId: "session-1",
      sourceType: "system",
      type: "resume",
      input: { text: "Continue from ContextPack" },
    });
  }

  function renameEvent(globalSeq: number, id: string): void {
    testDb.db.prepare("UPDATE events SET id = ? WHERE global_seq = ?").run(id, globalSeq);
  }

  function countRows(table: string): number {
    return (testDb.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  }
});
