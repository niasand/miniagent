import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, disposeTestDb } from "./helpers.js";
import type { SqliteDatabase } from "../src/server/db/migrate.js";
import { EventStore } from "../src/server/stores/event-store.js";
import { SessionStore } from "../src/server/stores/session-store.js";
import { OutboxStore } from "../src/server/stores/outbox-store.js";
import { MessageStore } from "../src/server/stores/message-store.js";
import { ContextBudgetStore } from "../src/server/stores/context-budget-store.js";
import { DeliveryWorker } from "../src/server/services/delivery.js";
import { WorkspaceService } from "../src/server/services/workspace.js";
import type { ChannelAdapter } from "../src/server/channels/types.js";

let db: SqliteDatabase;
let events: EventStore;
let sessions: SessionStore;
let outbox: OutboxStore;
let messages: MessageStore;

beforeEach(() => {
  db = createTestDb();
  events = new EventStore(db);
  sessions = new SessionStore(db, events);
  outbox = new OutboxStore(db);
  messages = new MessageStore(db);
});

afterEach(() => disposeTestDb(db));

// ── DeliveryWorker ──

describe("DeliveryWorker", () => {
  function createMockChannel(succeed = true): ChannelAdapter {
    return {
      channelType: "feishu",
      start: vi.fn(),
      stop: vi.fn(),
      send: succeed
        ? vi.fn().mockResolvedValue({ providerMessageId: "mock_msg_1" })
        : vi.fn().mockRejectedValue(new Error("Network error")),
    };
  }

  it("claims and delivers pending outbox items", async () => {
    const channel = createMockChannel();
    const worker = new DeliveryWorker(db, (ct) => ct === "feishu" ? channel : null);

    // Setup: session + enqueue item
    const session = sessions.createSession({
      title: "T",
      agentType: "claude",
      workspacePath: "/tmp",
      channelType: "feishu",
      channelRef: "c2c:1",
    });
    outbox.enqueue({
      sessionId: session.id,
      channelType: "feishu",
      targetRef: "c2c:1",
      kind: "feishu_markdown",
      viewModel: { text: "Hello!" },
      idempotencyKey: "test:1",
    });

    await worker.tick("worker-1");

    expect(channel.send).toHaveBeenCalledWith("c2c:1", "Hello!");

    // Verify outbox item is now sent
    const remaining = outbox.claimDue({ workerId: "w2" });
    expect(remaining).toHaveLength(0);
  });

  it("marks item failed when channel throws", async () => {
    const channel = createMockChannel(false);
    const worker = new DeliveryWorker(db, (ct) => ct === "feishu" ? channel : null);

    const session = sessions.createSession({
      title: "T",
      agentType: "claude",
      workspacePath: "/tmp",
      channelType: "feishu",
      channelRef: "c2c:1",
    });
    outbox.enqueue({
      sessionId: session.id,
      channelType: "feishu",
      targetRef: "c2c:1",
      kind: "feishu_markdown",
      viewModel: { text: "fail me" },
      idempotencyKey: "test:fail",
    });

    await worker.tick("worker-1");

    // Item should be in failed state (backoff, not immediately reclaimable)
    const reclaimed = outbox.claimDue({ workerId: "w2" });
    expect(reclaimed).toHaveLength(0);
  });

  it("marks item failed when no adapter found", async () => {
    const worker = new DeliveryWorker(db, () => null);

    const session = sessions.createSession({
      title: "T",
      agentType: "claude",
      workspacePath: "/tmp",
      channelType: "qq",
      channelRef: "g:1",
    });
    outbox.enqueue({
      sessionId: session.id,
      channelType: "qq",
      targetRef: "g:1",
      kind: "qq_markdown",
      viewModel: { text: "orphan" },
      idempotencyKey: "test:no-adapter",
    });

    await worker.tick("worker-1");

    // Failed due to no adapter
    const reclaimed = outbox.claimDue({ workerId: "w2" });
    expect(reclaimed).toHaveLength(0);
  });

  it("auto-starts queued tasks via runtimeService", async () => {
    const startNextMock = vi.fn();
    const worker = new DeliveryWorker(db, () => null, { startNextQueuedTask: startNextMock });

    // Create session with a queued task
    const session = sessions.createSession({
      title: "T",
      agentType: "claude",
      workspacePath: process.cwd(),
    });
    sessions.createTask({
      sessionId: session.id,
      sourceType: "web",
      type: "message",
      input: { text: "queued" },
    });

    await worker.tick("worker-1");

    expect(startNextMock).toHaveBeenCalledWith(session.id);
  });

  it("handles multiple outbox items in one tick", async () => {
    const sentRefs: string[] = [];
    const channel: ChannelAdapter = {
      channelType: "telegram",
      start: vi.fn(),
      stop: vi.fn(),
      send: vi.fn().mockImplementation(async (ref: string) => {
        sentRefs.push(ref);
        return { providerMessageId: `msg_${sentRefs.length}` };
      }),
    };

    const session = sessions.createSession({
      title: "T",
      agentType: "claude",
      workspacePath: "/tmp",
      channelType: "telegram",
      channelRef: "chat:1",
    });

    for (let i = 0; i < 3; i++) {
      outbox.enqueue({
        sessionId: session.id,
        channelType: "telegram",
        targetRef: "chat:1",
        kind: "telegram_markdown",
        viewModel: { text: `msg ${i}` },
        idempotencyKey: `multi:${i}`,
      });
    }

    const worker = new DeliveryWorker(db, (ct) => ct === "telegram" ? channel : null);
    await worker.tick("worker-1");

    expect(sentRefs).toHaveLength(3);
  });
});

// ── WorkspaceService ──

describe("WorkspaceService", () => {
  it("returns empty snapshot when no sessions exist", () => {
    const service = new WorkspaceService(db);
    const snapshot = service.getSnapshot();

    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.selectedSessionId).toBeNull();
    expect(snapshot.runtime.status).toBe("idle");
    expect(snapshot.runtime.activeRunId).toBeNull();
  });

  it("returns session list with correct mapping", () => {
    sessions.createSession({ name: "Session A", title: "Session A", agentType: "claude", workspacePath: "/tmp" });
    sessions.createSession({ name: "Session B", title: "Session B", agentType: "codex", workspacePath: "/tmp" });

    const service = new WorkspaceService(db);
    const snapshot = service.getSnapshot();

    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.sessions[0].title).toBe("Session B"); // Most recent first
    expect(snapshot.sessions[0].name).toBe("Session B");
    expect(snapshot.sessions[0].agent).toBe("Codex");
    expect(snapshot.sessions[1].agent).toBe("Claude");
    expect(snapshot.sessions[0].initials).toBe("CO");
    expect(snapshot.sessions[0].channelType).toBeNull();
    expect(snapshot.sessions[0].updatedAt).toBeTruthy();
  });

  it("uses persisted session name before title and message fallbacks", () => {
    const session = sessions.createSession({
      name: "Manual name",
      title: "Claude session",
      agentType: "claude",
      workspacePath: "/tmp",
    });
    const event = events.append({ sessionId: session.id, type: "msg" });
    messages.insert({ sessionId: session.id, role: "user", content: "First message", sourceEventId: event.id });

    const service = new WorkspaceService(db);
    const snapshot = service.getSnapshot();

    expect(snapshot.sessions[0].name).toBe("Manual name");
  });

  it("uses the first user message as the name for default agent titles", () => {
    const session = sessions.createSession({ title: "Claude session", agentType: "claude", workspacePath: "/tmp" });
    const event = events.append({ sessionId: session.id, type: "msg" });
    messages.insert({
      sessionId: session.id,
      role: "user",
      content: "  Please summarize\n\nthis repository  ",
      sourceEventId: event.id,
    });

    const service = new WorkspaceService(db);
    const snapshot = service.getSnapshot();

    expect(snapshot.sessions[0].title).toBe("Claude session");
    expect(snapshot.sessions[0].name).toBe("Please summarize this repository");
  });

  it("returns messages for selected session", () => {
    const s1 = sessions.createSession({ title: "1", agentType: "claude", workspacePath: "/tmp" });
    const s2 = sessions.createSession({ title: "2", agentType: "claude", workspacePath: "/tmp" });

    const evt1 = events.append({ sessionId: s1.id, type: "msg" });
    const evt2 = events.append({ sessionId: s1.id, type: "msg" });
    messages.insert({ sessionId: s1.id, role: "user", content: "hi", sourceEventId: evt1.id });
    messages.insert({ sessionId: s1.id, role: "assistant", content: "there", sourceEventId: evt2.id });

    const evt3 = events.append({ sessionId: s2.id, type: "msg" });
    messages.insert({ sessionId: s2.id, role: "user", content: "other", sourceEventId: evt3.id });

    const service = new WorkspaceService(db);
    const snapshot = service.getSnapshot(s1.id);

    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[0].role).toBe("user");
    expect(snapshot.messages[0].markdown).toBe("hi");
    expect(snapshot.messages[1].role).toBe("agent");
    expect(snapshot.messages[1].markdown).toBe("there");
  });

  it("computes run stats from events", () => {
    const session = sessions.createSession({ title: "T", agentType: "claude", workspacePath: "/tmp" });
    const { task } = sessions.createTask({ sessionId: session.id, sourceType: "web", type: "message", input: {} });

    const startedAt = new Date(Date.now() - 5000).toISOString();
    const stoppedAt = new Date().toISOString();
    const { run } = sessions.startRun({ sessionId: session.id, taskId: task.id, startedAt });
    sessions.finishRun({ runId: run.id, status: "succeeded", stoppedAt });

    // Add text_delta events
    events.append({ sessionId: session.id, runId: run.id, type: "text_delta", payload: { text: "a", tokenEstimate: 100 } });
    events.append({ sessionId: session.id, runId: run.id, type: "text_delta", payload: { text: "b", tokenEstimate: 200 } });

    const service = new WorkspaceService(db);
    const snapshot = service.getSnapshot(session.id);

    expect(snapshot.runStats.durationSeconds).toBe(5);
    expect(snapshot.runStats.tokensUsed).toBe(300);
  });

  it("returns context budget info", () => {
    const session = sessions.createSession({ title: "T", agentType: "claude", workspacePath: "/tmp" });

    const budgets = new ContextBudgetStore(db);
    const result = budgets.upsert({ sessionId: session.id, budgetTokens: 100_000, tokenEstimate: 30_000 });
    expect(result).not.toBeNull();
    expect(result.budgetTokens).toBe(100_000);

    // Verify read-back
    const fetched = budgets.get(session.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.budgetTokens).toBe(100_000);

    const service = new WorkspaceService(db);
    const snapshot = service.getSnapshot(session.id);

    expect(snapshot.contextBudget.status).toBe("healthy");
    expect(snapshot.contextBudget.budgetTokens).toBe(100_000);
    expect(snapshot.contextBudget.tokenEstimate).toBe(30_000);
    expect(snapshot.contextBudget.usagePercent).toBe(30);
  });

  it("selects first session when none specified", () => {
    sessions.createSession({ title: "First", agentType: "claude", workspacePath: "/tmp" });
    sessions.createSession({ title: "Second", agentType: "claude", workspacePath: "/tmp" });

    const service = new WorkspaceService(db);
    const snapshot = service.getSnapshot();

    // Most recent session first in list
    expect(snapshot.selectedSessionId).toBe(snapshot.sessions[0].id);
  });
});
