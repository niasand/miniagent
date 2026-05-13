import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/server/events/event-store.js";
import { createId } from "../../src/shared/ids.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";
import { insertActiveRunFixture } from "../support/fixtures.js";

describe("EventStore", () => {
  let testDb: TestDatabase;
  let events: EventStore;

  beforeEach(() => {
    testDb = createTestDatabase();
    insertActiveRunFixture(testDb.db);
    events = new EventStore(testDb.db);
  });

  afterEach(() => {
    testDb.close();
  });

  it("creates prefixed UUIDv7-style IDs", () => {
    expect(createId("evt")).toMatch(
      /^evt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("appends run events with automatic run_seq and global_seq", () => {
    const first = events.append({
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "text_delta",
      payload: { text: "hello" },
    });
    const second = events.append({
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "message_completed",
      payload: { messageId: "message-1" },
    });

    expect(first.runSeq).toBe(1);
    expect(second.runSeq).toBe(2);
    expect(second.globalSeq).toBe(first.globalSeq + 1);
    expect(first.payload).toEqual({ text: "hello" });
  });

  it("lists events after a global replay cursor", () => {
    const first = events.append({
      id: "event-1",
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "text_delta",
      payload: { text: "one" },
    });
    const second = events.append({
      id: "event-2",
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "text_delta",
      payload: { text: "two" },
    });

    expect(events.listAfterGlobalSeq({ afterGlobalSeq: first.globalSeq })).toEqual([second]);
    expect(events.listAfterGlobalSeq({ sessionId: "session-1", afterGlobalSeq: 0, limit: 1 })).toEqual([first]);
  });

  it("keeps runtime appends separate from Outbox projection work", () => {
    events.append({
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "text_delta",
      payload: { text: "runtime only" },
    });

    const count = testDb.db.prepare("SELECT COUNT(*) AS count FROM outbox").get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("rejects run_seq without a run_id before touching SQLite", () => {
    expect(() => {
      events.append({
        sessionId: "session-1",
        runSeq: 1,
        type: "task_created",
        payload: {},
      });
    }).toThrow("runSeq requires runId");
  });
});
