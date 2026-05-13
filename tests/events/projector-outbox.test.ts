import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/server/events/event-store.js";
import { OutboxStore } from "../../src/server/events/outbox-store.js";
import { ProjectorStore } from "../../src/server/events/projector-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";
import { insertActiveRunFixture } from "../support/fixtures.js";

describe("Projector and Outbox stores", () => {
  let testDb: TestDatabase;
  let events: EventStore;
  let outbox: OutboxStore;
  let projectors: ProjectorStore;

  beforeEach(() => {
    testDb = createTestDatabase();
    insertActiveRunFixture(testDb.db);
    events = new EventStore(testDb.db);
    outbox = new OutboxStore(testDb.db);
    projectors = new ProjectorStore(testDb.db);
  });

  afterEach(() => {
    testDb.close();
  });

  it("reads projector batches by global_seq and prevents cursor regression", () => {
    const first = appendTextEvent("event-1", "one");
    const second = appendTextEvent("event-2", "two");

    expect(projectors.readEventBatch("messages", 10).map((event) => event.id)).toEqual(["event-1", "event-2"]);

    projectors.advanceOffset("messages", second, "2026-05-13T00:00:00.000Z");
    projectors.advanceOffset("messages", first, "2026-05-13T00:00:01.000Z");

    expect(projectors.getOffset("messages")).toMatchObject({
      lastGlobalSeq: second.globalSeq,
      lastEventId: "event-2",
    });
    expect(projectors.readEventBatch("messages", 10)).toEqual([]);
  });

  it("projects a batch and enqueues Outbox work in one transaction", () => {
    appendTextEvent("event-1", "one");
    appendTextEvent("event-2", "two");

    const result = projectors.projectBatch("web_delivery", { limit: 10 }, (batch) => {
      for (const event of batch) {
        outbox.enqueue({
          sessionId: event.sessionId,
          eventId: event.id,
          eventGlobalSeq: event.globalSeq,
          channelType: "web",
          targetRef: "session-1",
          kind: "web_event",
          viewModel: { type: event.type, payload: event.payload },
          idempotencyKey: `web:${event.id}`,
        });
      }
    });

    expect(result).toMatchObject({ processed: 2, lastEventId: "event-2" });
    expect(projectors.getOffset("web_delivery")).toMatchObject({
      lastGlobalSeq: result.lastGlobalSeq,
      lastEventId: "event-2",
    });

    const rows = testDb.db
      .prepare("SELECT event_id FROM outbox ORDER BY event_global_seq ASC")
      .all()
      .map((row) => (row as { event_id: string }).event_id);
    expect(rows).toEqual(["event-1", "event-2"]);
  });

  it("claims due outbox rows with leases and excludes already claimed work", () => {
    const event = appendTextEvent("event-1", "hello");
    outbox.enqueue({
      sessionId: "session-1",
      eventId: event.id,
      eventGlobalSeq: event.globalSeq,
      channelType: "web",
      targetRef: "session-1",
      kind: "web_event",
      viewModel: { type: event.type },
      idempotencyKey: "web:event-1",
    });

    const claimed = outbox.claimDue({
      workerId: "worker-1",
      limit: 10,
      leaseMs: 30_000,
      now: "2026-05-13T00:00:00.000Z",
    });
    const claimedAgain = outbox.claimDue({
      workerId: "worker-2",
      limit: 10,
      leaseMs: 30_000,
      now: "2026-05-13T00:00:01.000Z",
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      status: "sending",
      attempts: 1,
      lockedBy: "worker-1",
      leaseExpiresAt: "2026-05-13T00:00:30.000Z",
    });
    expect(claimedAgain).toHaveLength(0);
  });

  it("recovers expired leases and moves exhausted failures to dead", () => {
    const event = appendTextEvent("event-1", "hello");
    const item = outbox.enqueue({
      sessionId: "session-1",
      eventId: event.id,
      eventGlobalSeq: event.globalSeq,
      channelType: "web",
      targetRef: "session-1",
      kind: "web_event",
      viewModel: { type: event.type },
      idempotencyKey: "web:event-1",
      maxAttempts: 1,
    });

    outbox.claimDue({
      workerId: "worker-1",
      limit: 10,
      leaseMs: 1_000,
      now: "2026-05-13T00:00:00.000Z",
    });
    expect(outbox.releaseExpiredLeases("2026-05-13T00:00:01.000Z")).toBe(1);

    const reclaimed = outbox.claimDue({
      workerId: "worker-2",
      limit: 10,
      leaseMs: 1_000,
      now: "2026-05-13T00:00:02.000Z",
    });
    expect(reclaimed).toHaveLength(0);

    const failed = outbox.markFailed(item.id, "redacted delivery error", null, "2026-05-13T00:00:02.000Z");
    expect(failed).toMatchObject({
      status: "dead",
      lastError: "redacted delivery error",
      lockedBy: null,
    });
  });

  function appendTextEvent(id: string, text: string) {
    return events.append({
      id,
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      type: "text_delta",
      payload: { text },
    });
  }
});
