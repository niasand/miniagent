import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextBudgetService } from "../../src/server/context/context-budget-service.js";
import { ContextBudgetStore } from "../../src/server/context/context-budget-store.js";
import { ContextPackStore } from "../../src/server/context/context-pack-store.js";
import { EventStore } from "../../src/server/events/event-store.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("ContextBudgetService", () => {
  let testDb: TestDatabase;
  let events: EventStore;
  let sessions: SessionStore;
  let budgets: ContextBudgetStore;
  let contextPacks: ContextPackStore;
  let service: ContextBudgetService;

  beforeEach(() => {
    testDb = createTestDatabase();
    events = new EventStore(testDb.db);
    sessions = new SessionStore(testDb.db, events);
    budgets = new ContextBudgetStore(testDb.db);
    contextPacks = new ContextPackStore(testDb.db);
    service = new ContextBudgetService(testDb.db, events);
  });

  afterEach(() => {
    testDb.close();
  });

  it("persists budget status and creates a ContextPack at the critical threshold", () => {
    createSessionWithRun();
    events.append({
      id: "event-large-output",
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "text_delta",
      payload: { text: "x".repeat(1_200) },
    });

    const result = service.evaluate({
      sessionId: "session-1",
      budgetTokens: 100,
      evaluatedAt: "2026-05-13T00:05:00.000Z",
    });

    expect(result.compacted?.contextPack).toMatchObject({
      sessionId: "session-1",
      status: "ready",
      sourceEventEndId: "event-large-output",
      createdBy: "system",
    });
    expect(result.budget).toMatchObject({
      sessionId: "session-1",
      budgetTokens: 100,
      currentContextPackId: result.compacted?.contextPack.id,
      lastCompactedAt: "2026-05-13T00:05:00.000Z",
    });
    expect(["healthy", "warning", "critical", "overflow"]).toContain(result.budget.status);
    expect(contextPacks.getLatestReady("session-1")).toMatchObject({ id: result.compacted?.contextPack.id });
    expect(readEventTypes()).toEqual(expect.arrayContaining(["context_pack_created", "context_budget_changed"]));
  });

  it("does not create another ContextPack when the latest pack already covers the newest context event", () => {
    createSessionWithRun();
    events.append({
      id: "event-large-output",
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "text_delta",
      payload: { text: "x".repeat(1_200) },
    });

    const first = service.evaluate({ sessionId: "session-1", budgetTokens: 100 });
    const second = service.evaluate({ sessionId: "session-1", budgetTokens: 100 });

    expect(first.compacted?.contextPack.id).toBeTruthy();
    expect(second.compacted).toBeNull();
    expect(countRows("context_packs")).toBe(1);
  });

  it("supports manual compact while preserving raw events", () => {
    createSessionWithRun();
    events.append({
      id: "event-output",
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "text_delta",
      payload: { text: "short output" },
    });
    const before = countRows("events");

    const result = service.compactNow({
      sessionId: "session-1",
      createdBy: "user",
      compactedAt: "2026-05-13T00:06:00.000Z",
    });

    expect(result.contextPack).toMatchObject({
      id: result.contextPack?.id,
      sourceEventEndId: "event-output",
      createdBy: "user",
    });
    expect(budgets.get("session-1")).toMatchObject({
      currentContextPackId: result.contextPack?.id,
      lastCompactedAt: "2026-05-13T00:06:00.000Z",
    });
    expect(countRows("events")).toBe(before + 2);
    expect(events.listAfterGlobalSeq({ sessionId: "session-1", afterGlobalSeq: 0 }).map((event) => event.id)).toContain(
      "event-output",
    );
  });

  function createSessionWithRun(): void {
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
      input: { text: "Build context budget" },
    });
    sessions.startRun({ id: "run-1", sessionId: "session-1", taskId: "task-1" });
  }

  function readEventTypes(): string[] {
    return testDb.db
      .prepare("SELECT type FROM events WHERE session_id = 'session-1' ORDER BY global_seq ASC")
      .all()
      .map((row) => (row as { type: string }).type);
  }

  function countRows(table: string): number {
    return (testDb.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  }
});
