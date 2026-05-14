import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeishuDeliveryService, type FeishuDeliveryClient } from "../../src/server/channels/feishu-delivery-service.js";
import { EventStore } from "../../src/server/events/event-store.js";
import { OutboxStore } from "../../src/server/events/outbox-store.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("FeishuDeliveryService", () => {
  let testDb: TestDatabase;
  let events: EventStore;
  let outbox: OutboxStore;
  let sessions: SessionStore;

  beforeEach(() => {
    testDb = createTestDatabase();
    events = new EventStore(testDb.db);
    outbox = new OutboxStore(testDb.db);
    sessions = new SessionStore(testDb.db, events);
    sessions.createSession({
      id: "session-1",
      title: "Feishu session",
      agentType: "codex",
      workspacePath: "/tmp/miniagent-test",
      channelType: "feishu",
      channelRef: "chat-1",
    });
  });

  afterEach(() => {
    testDb.close();
  });

  it("delivers Feishu card outbox items and appends delivery events", async () => {
    outbox.enqueue({
      id: "outbox-1",
      sessionId: "session-1",
      channelType: "feishu",
      targetRef: "chat-1",
      kind: "feishu_card_create",
      viewModel: { title: "MiniAgent" },
      idempotencyKey: "feishu:card:1",
    });
    const client = fakeClient();

    const result = await new FeishuDeliveryService(testDb.db, client, events).deliverDue({
      workerId: "worker-1",
      now: "2026-05-13T00:00:00.000Z",
    });

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(client.sendCard).toHaveBeenCalledWith("chat-1", { title: "MiniAgent" });
    expect(outbox.getByIdempotencyKey("feishu:card:1")).toMatchObject({
      status: "sent",
      providerMessageId: "provider-card-1",
    });
    expect(readEventTypes()).toContain("delivery_succeeded");
    expect(readAuditActions()).toContain("delivery_succeeded");
  });

  it("marks Feishu delivery failures for retry and records the failure event", async () => {
    outbox.enqueue({
      id: "outbox-1",
      sessionId: "session-1",
      channelType: "feishu",
      targetRef: "chat-1",
      kind: "feishu_card_update",
      viewModel: { title: "MiniAgent" },
      idempotencyKey: "feishu:card:1",
      maxAttempts: 3,
    });
    const client = fakeClient();
    client.updateCard.mockRejectedValueOnce(new Error("rate limited"));

    const result = await new FeishuDeliveryService(testDb.db, client, events).deliverDue({
      workerId: "worker-1",
      now: "2026-05-13T00:00:00.000Z",
    });

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(outbox.getByIdempotencyKey("feishu:card:1")).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "rate limited",
      nextAttemptAt: "2026-05-13T00:00:01.000Z",
    });
    expect(readEventTypes()).toContain("delivery_failed");
    expect(readAuditActions()).toContain("delivery_failed");
  });

  function fakeClient(): FeishuDeliveryClient & {
    sendText: ReturnType<typeof vi.fn>;
    sendCard: ReturnType<typeof vi.fn>;
    updateCard: ReturnType<typeof vi.fn>;
  } {
    return {
      sendText: vi.fn(async () => ({ providerMessageId: "provider-text-1" })),
      sendCard: vi.fn(async () => ({ providerMessageId: "provider-card-1" })),
      updateCard: vi.fn(async () => ({ providerMessageId: "provider-card-update-1" })),
    };
  }

  function readEventTypes(): string[] {
    return testDb.db
      .prepare("SELECT type FROM events WHERE session_id = 'session-1' ORDER BY global_seq ASC")
      .all()
      .map((row) => (row as { type: string }).type);
  }

  function readAuditActions(): string[] {
    return testDb.db
      .prepare("SELECT action FROM audit_logs ORDER BY created_at ASC, id ASC")
      .all()
      .map((row) => (row as { action: string }).action);
  }
});
