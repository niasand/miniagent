import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, disposeTestDb } from "./helpers.js";
import type { SqliteDatabase } from "../src/server/db/migrate.js";
import { EventStore } from "../src/server/stores/event-store.js";
import { SessionStore } from "../src/server/stores/session-store.js";
import { MessageStore } from "../src/server/stores/message-store.js";
import { OutboxStore } from "../src/server/stores/outbox-store.js";
import { ScheduleStore } from "../src/server/stores/schedule-store.js";
import { PermissionRequestStore } from "../src/server/stores/permission-request-store.js";
import { ContextBudgetStore } from "../src/server/stores/context-budget-store.js";

let db: SqliteDatabase;
let events: EventStore;
let sessions: SessionStore;
let messages: MessageStore;
let outbox: OutboxStore;
let schedules: ScheduleStore;
let permissions: PermissionRequestStore;

beforeEach(() => {
  db = createTestDb();
  events = new EventStore(db);
  sessions = new SessionStore(db, events);
  messages = new MessageStore(db);
  outbox = new OutboxStore(db);
  schedules = new ScheduleStore(db);
  permissions = new PermissionRequestStore(db);
});

afterEach(() => disposeTestDb(db));

describe("SessionStore", () => {
  it("creates and retrieves a session", () => {
    const session = sessions.createSession({
      title: "Test session",
      agentType: "claude",
      workspacePath: "/tmp/test",
    });
    expect(session.id).toMatch(/^ses_/);
    expect(session.title).toBe("Test session");
    expect(session.status).toBe("idle");

    const fetched = sessions.getSession(session.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(session.id);
  });

  it("creates a session with channel info", () => {
    const session = sessions.createSession({
      title: "Feishu chat",
      agentType: "claude",
      workspacePath: "/tmp/test",
      channelType: "feishu",
      channelRef: "c2c:123",
    });
    expect(session.channelType).toBe("feishu");
    expect(session.channelRef).toBe("c2c:123");
  });

  it("finds session by channel", () => {
    sessions.createSession({
      title: "Test",
      agentType: "claude",
      workspacePath: "/tmp",
      channelType: "telegram",
      channelRef: "chat:999",
    });
    const found = sessions.findSessionByChannel("telegram", "chat:999");
    expect(found).not.toBeNull();
    expect(found!.channelRef).toBe("chat:999");
  });

  it("creates task and run with correct lifecycle", () => {
    const session = sessions.createSession({
      title: "Test",
      agentType: "claude",
      workspacePath: "/tmp",
    });

    const { task } = sessions.createTask({
      sessionId: session.id,
      sourceType: "web",
      type: "message",
      input: { text: "hello" },
    });
    expect(task.status).toBe("queued");
    expect(task.sessionId).toBe(session.id);

    const { run } = sessions.startRun({
      sessionId: session.id,
      taskId: task.id,
      agentType: "claude",
    });
    expect(run.status).toBe("running");
    expect(run.sessionId).toBe(session.id);

    sessions.finishRun({ runId: run.id, status: "succeeded" });
    const finished = sessions.getRun(run.id);
    expect(finished!.status).toBe("succeeded");
    expect(finished!.stoppedAt).not.toBeNull();
  });

  it("enforces dedupe key on tasks", () => {
    const session = sessions.createSession({
      title: "Test",
      agentType: "claude",
      workspacePath: "/tmp",
    });

    sessions.createTask({
      sessionId: session.id,
      sourceType: "web",
      type: "message",
      input: {},
      dedupeKey: "unique:1",
    });

    expect(() =>
      sessions.createTask({
        sessionId: session.id,
        sourceType: "web",
        type: "message",
        input: {},
        dedupeKey: "unique:1",
      })
    ).toThrow();
  });

  it("finds sessions with queued tasks", () => {
    const s1 = sessions.createSession({ title: "1", agentType: "claude", workspacePath: "/tmp" });
    const s2 = sessions.createSession({ title: "2", agentType: "claude", workspacePath: "/tmp" });

    sessions.createTask({ sessionId: s1.id, sourceType: "web", type: "message", input: {} });
    sessions.createTask({ sessionId: s2.id, sourceType: "web", type: "message", input: {} });

    const ids = sessions.getSessionIdsWithQueuedTasks();
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);
  });
});

describe("EventStore", () => {
  it("appends events with auto-incrementing global_seq", () => {
    const session = sessions.createSession({ title: "T", agentType: "claude", workspacePath: "/tmp" });
    const e1 = events.append({ sessionId: session.id, type: "task_created", payload: { a: 1 } });
    const e2 = events.append({ sessionId: session.id, type: "task_created", payload: { a: 2 } });
    expect(e1.globalSeq).toBeGreaterThan(0);
    expect(e2.globalSeq).toBeGreaterThan(e1.globalSeq);
  });

  it("queries events after global seq", () => {
    const session = sessions.createSession({ title: "T", agentType: "claude", workspacePath: "/tmp" });
    events.append({ sessionId: session.id, type: "e1" });
    const e2 = events.append({ sessionId: session.id, type: "e2" });
    events.append({ sessionId: session.id, type: "e3" });

    const after = events.listAfterGlobalSeq({ sessionId: session.id, afterGlobalSeq: e2.globalSeq });
    expect(after).toHaveLength(1);
    expect(after[0].type).toBe("e3");
  });

  it("lists events by run and type", () => {
    const session = sessions.createSession({ title: "T", agentType: "claude", workspacePath: "/tmp" });
    events.append({ sessionId: session.id, runId: "run_1", type: "text_delta", payload: { text: "a" } });
    events.append({ sessionId: session.id, runId: "run_1", type: "text_delta", payload: { text: "b" } });
    events.append({ sessionId: session.id, runId: "run_1", type: "tool_call", payload: {} });
    events.append({ sessionId: session.id, runId: "run_2", type: "text_delta", payload: { text: "c" } });

    const deltas = events.listByRun("run_1", "text_delta");
    expect(deltas).toHaveLength(2);

    const all = events.listByRun("run_1");
    expect(all).toHaveLength(3);
  });
});

describe("MessageStore", () => {
  it("inserts and retrieves messages", () => {
    const session = sessions.createSession({ title: "T", agentType: "claude", workspacePath: "/tmp" });
    const event = events.append({ sessionId: session.id, type: "message" });
    messages.insert({ sessionId: session.id, role: "user", content: "hello", sourceEventId: event.id });
    messages.insert({ sessionId: session.id, role: "assistant", content: "world", sourceEventId: event.id });

    const latest = messages.getLatestBySession(session.id, 10);
    expect(latest).toHaveLength(2);
    expect(latest[0].role).toBe("user");
    expect(latest[1].content).toBe("world");
  });
});

describe("OutboxStore", () => {
  it("enqueues items with idempotency", () => {
    const item = outbox.enqueue({
      sessionId: "ses_1",
      channelType: "feishu",
      targetRef: "c2c:1",
      kind: "feishu_markdown",
      viewModel: { text: "hello" },
      idempotencyKey: "dedup:1",
    });
    expect(item.id).toMatch(/^out_/);
    expect(item.status).toBe("pending");

    // Second enqueue with same key returns existing
    const dup = outbox.enqueue({
      sessionId: "ses_1",
      channelType: "feishu",
      targetRef: "c2c:1",
      kind: "feishu_markdown",
      viewModel: { text: "hello again" },
      idempotencyKey: "dedup:1",
    });
    expect(dup.id).toBe(item.id);
  });

  it("claims due items with lease", () => {
    outbox.enqueue({
      sessionId: "ses_1",
      channelType: "telegram",
      targetRef: "chat:1",
      kind: "telegram_markdown",
      idempotencyKey: "t:1",
    });

    const claimed = outbox.claimDue({ workerId: "w1", channelType: "telegram" });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].status).toBe("sending");
    expect(claimed[0].lockedBy).toBe("w1");
  });

  it("marks items as sent", () => {
    outbox.enqueue({
      sessionId: "ses_1",
      channelType: "feishu",
      targetRef: "c2c:1",
      kind: "feishu_markdown",
      idempotencyKey: "f:1",
    });

    const [item] = outbox.claimDue({ workerId: "w1" });
    outbox.markSent(item.id, "provider_msg_123");

    // Verify can't claim again
    const reclaimed = outbox.claimDue({ workerId: "w2" });
    expect(reclaimed).toHaveLength(0);
  });

  it("marks items as failed with backoff", () => {
    outbox.enqueue({
      sessionId: "ses_1",
      channelType: "discord",
      targetRef: "ch:1",
      kind: "discord_markdown",
      idempotencyKey: "d:1",
    });

    const [item] = outbox.claimDue({ workerId: "w1" });
    outbox.markFailed(item.id, "Network error");

    // Should be reclaimable after backoff
    const failed = outbox.claimDue({ workerId: "w2" });
    expect(failed).toHaveLength(0); // Still in backoff (next_attempt_at in future)
  });
});

describe("ScheduleStore", () => {
  it("creates and lists schedules", () => {
    const schedule = schedules.create({
      sessionId: "ses_1",
      kind: "cron",
      cronExpr: "*/5 * * * *",
    });
    expect(schedule.id).toMatch(/^sch_/);
    expect(schedule.status).toBe("active");

    const list = schedules.listBySession("ses_1");
    expect(list).toHaveLength(1);
  });

  it("claims due schedules", () => {
    schedules.create({ sessionId: "ses_1", kind: "once", runAt: new Date(Date.now() - 1000).toISOString() });
    const due = schedules.claimDue();
    expect(due.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PermissionRequestStore", () => {
  it("upserts and responds to permission requests", () => {
    const req = permissions.upsert({
      sessionId: "ses_1",
      runId: "run_1",
      acpRequestId: "acp_1",
      prompt: "Allow file write?",
      options: [{ id: "allow", label: "Allow" }],
    });
    expect(req.status).toBe("pending");

    const responded = permissions.respond("run_1", "acp_1", "approved", "allow");
    expect(responded!.status).toBe("approved");
    expect(responded!.selectedOptionId).toBe("allow");
  });

  it("upserts update existing request", () => {
    permissions.upsert({ sessionId: "ses_1", runId: "run_1", acpRequestId: "acp_1", prompt: "First" });
    const updated = permissions.upsert({ sessionId: "ses_1", runId: "run_1", acpRequestId: "acp_1", prompt: "Second" });
    expect(updated.prompt).toBe("Second");

    const list = permissions.listByRun("run_1");
    expect(list).toHaveLength(1);
  });
});

describe("ContextBudgetStore", () => {
  it("upserts and retrieves budget", () => {
    const budgets = new ContextBudgetStore(db);

    // Check before upsert
    const before = budgets.get("ses_test1");
    expect(before).toBeNull();

    const result = budgets.upsert("ses_test1", { budgetTokens: 100_000, tokenEstimate: 30_000 });
    expect(result).not.toBeNull();

    const fetched = budgets.get("ses_test1");
    expect(fetched).not.toBeNull();
    expect(fetched!.budgetTokens).toBe(100_000);
    expect(fetched!.tokenEstimate).toBe(30_000);
  });
});
