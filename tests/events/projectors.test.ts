import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/server/events/event-store.js";
import { MessageStore } from "../../src/server/events/message-store.js";
import { OutboxStore } from "../../src/server/events/outbox-store.js";
import { MessageProjector, WebOutboxProjector } from "../../src/server/events/projectors.js";
import { ProjectorStore } from "../../src/server/events/projector-store.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { parseJson } from "../../src/shared/json.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("event projectors", () => {
  let testDb: TestDatabase;
  let eventStore: EventStore;
  let sessionStore: SessionStore;

  beforeEach(() => {
    testDb = createTestDatabase();
    eventStore = new EventStore(testDb.db);
    sessionStore = new SessionStore(testDb.db, eventStore);
    createRunFixture();
  });

  afterEach(() => {
    testDb.close();
  });

  it("projects EventStore history into rebuildable messages", () => {
    const messageProjector = new MessageProjector(testDb.db);
    const messages = new MessageStore(testDb.db);

    const first = messageProjector.projectNextBatch({ batchSize: 100 });
    const second = messageProjector.projectNextBatch({ batchSize: 100 });

    expect(first.processed).toBe(5);
    expect(second.processed).toBe(0);
    expect(new ProjectorStore(testDb.db).getOffset("messages")).toMatchObject({
      lastGlobalSeq: first.lastGlobalSeq,
      lastEventId: "event-finished",
    });

    expect(messages.listBySession("session-1").map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "Generate the first migration" },
      { role: "assistant", content: "Created migration." },
      { role: "tool", content: "sqlite warning" },
      { role: "system", content: "Run succeeded: completed" },
    ]);
  });

  it("projects EventStore history into idempotent Web Outbox work", () => {
    const webOutboxProjector = new WebOutboxProjector(testDb.db);
    const outbox = new OutboxStore(testDb.db);

    const first = webOutboxProjector.projectNextBatch({ batchSize: 100 });
    const second = webOutboxProjector.projectNextBatch({ batchSize: 100 });

    expect(first.processed).toBe(5);
    expect(second.processed).toBe(0);

    const rows = testDb.db
      .prepare("SELECT event_id, idempotency_key, view_model_json FROM outbox ORDER BY event_global_seq ASC")
      .all() as Array<{ event_id: string; idempotency_key: string; view_model_json: string }>;

    expect(rows.map((row) => row.idempotency_key)).toEqual([
      "web:event-task",
      "web:event-started",
      "web:event-text",
      "web:event-stderr",
      "web:event-finished",
    ]);
    expect(rows[2].event_id).toBe("event-text");
    expect(parseJson(rows[2].view_model_json)).toMatchObject({
      type: "event",
      event: {
        id: "event-text",
        type: "text_delta",
        payload: { text: "Created migration." },
      },
    });

    expect(outbox.enqueueOnce({
      sessionId: "session-1",
      eventId: "event-text",
      eventGlobalSeq: 3,
      channelType: "web",
      targetRef: "session-1",
      kind: "web_event",
      viewModel: { duplicate: true },
      idempotencyKey: "web:event-text",
    })).toMatchObject({ idempotencyKey: "web:event-text" });

    const count = testDb.db.prepare("SELECT COUNT(*) AS count FROM outbox").get() as { count: number };
    expect(count.count).toBe(5);
  });

  it("keeps projector offset unchanged when projection work fails", () => {
    const projectors = new ProjectorStore(testDb.db);

    expect(() => {
      projectors.projectBatch("failing_projector", { limit: 100 }, () => {
        throw new Error("projection failed");
      });
    }).toThrow("projection failed");

    expect(projectors.getOffset("failing_projector")).toMatchObject({
      lastGlobalSeq: 0,
      lastEventId: null,
    });
  });

  function createRunFixture(): void {
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
      input: { text: "Generate the first migration" },
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
      payload: { text: "Created migration." },
    });
    eventStore.append({
      id: "event-stderr",
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "runtime_stderr",
      payload: { text: "sqlite warning" },
    });
    sessionStore.finishRun({
      runId: "run-1",
      status: "succeeded",
      stopReason: "completed",
    });

    renameEvent(5, "event-finished");
  }

  function renameEvent(globalSeq: number, id: string): void {
    testDb.db.prepare("UPDATE events SET id = ? WHERE global_seq = ?").run(id, globalSeq);
  }
});
