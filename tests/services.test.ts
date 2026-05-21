import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, disposeTestDb } from "./helpers.js";
import type { SqliteDatabase } from "../src/server/db/migrate.js";
import { EventStore } from "../src/server/stores/event-store.js";
import { SessionStore } from "../src/server/stores/session-store.js";
import { OutboxStore } from "../src/server/stores/outbox-store.js";
import { InboundService } from "../src/server/services/inbound.js";
import { WorkspacePolicy } from "../src/server/security/workspace-policy.js";
import { SchedulerService } from "../src/server/services/scheduler.js";
import { ContextService } from "../src/server/services/context.js";

let db: SqliteDatabase;

beforeEach(() => { db = createTestDb(); });
afterEach(() => disposeTestDb(db));

function makeInbound(channelType = "web") {
  return new InboundService(db, channelType, {
    workspacePolicy: new WorkspacePolicy([process.cwd()]),
  });
}

describe("InboundService", () => {
  it("creates session on first message from new chat", () => {
    const inbound = makeInbound("feishu");
    const result = inbound.receiveMessage({
      messageId: "msg_1",
      chatId: "c2c:user1",
      userId: "user_001",
      text: "Hello agent",
      chatType: "private",
    });

    expect(result.action).toBe("message");
    expect(result.session.channelType).toBe("feishu");
    expect(result.session.channelRef).toBe("c2c:user1");
    expect(result.taskId).toBeDefined();
  });

  it("persists the first user message as an empty session name", () => {
    const inbound = makeInbound("web");
    const result = inbound.receiveMessage({
      messageId: "msg_1",
      chatId: "web-chat",
      userId: "web_user",
      text: "  Summarize\n\nthis repo  ",
      chatType: "private",
    });
    const sessions = new SessionStore(db, new EventStore(db));
    const session = sessions.getSession(result.session.id);

    expect(session?.name).toBe("Summarize this repo");
  });

  it("reuses session for same chat", () => {
    const inbound = makeInbound("telegram");

    const r1 = inbound.receiveMessage({
      messageId: "msg_1", chatId: "chat:123", userId: "u1", text: "hi", chatType: "private",
    });
    const r2 = inbound.receiveMessage({
      messageId: "msg_2", chatId: "chat:123", userId: "u1", text: "hello again", chatType: "private",
    });

    expect(r1.session.id).toBe(r2.session.id);
  });

  it("handles /agent list command", () => {
    const inbound = makeInbound("feishu");
    const result = inbound.receiveMessage({
      messageId: "msg_1", chatId: "c2c:1", userId: "u1", text: "/agent list", chatType: "private",
    });
    expect(result.action).toBe("command");
  });

  it("ignores empty messages", () => {
    const inbound = makeInbound("web");
    const result = inbound.receiveMessage({
      messageId: "msg_1", chatId: "chat:1", userId: "u1", text: "   ", chatType: "private",
    });
    expect(result.action).toBe("ignored");
  });

  it("dedupes by messageId", () => {
    const inbound = makeInbound("discord");
    inbound.receiveMessage({
      messageId: "dup_1", chatId: "ch:1", userId: "u1", text: "first", chatType: "group",
    });

    // Same messageId should throw or return ignored
    expect(() =>
      inbound.receiveMessage({
        messageId: "dup_1", chatId: "ch:1", userId: "u1", text: "dup", chatType: "group",
      })
    ).toThrow();
  });
});

describe("SchedulerService", () => {
  it("creates and lists schedules", () => {
    const events = new EventStore(db);
    const sessions = new SessionStore(db, events);
    const session = sessions.createSession({ title: "T", agentType: "claude", workspacePath: "/tmp" });

    const scheduler = new SchedulerService(db);
    const schedule = scheduler.create({
      sessionId: session.id,
      kind: "cron",
      cronExpr: "0 9 * * 1-5",
    });

    expect(schedule.id).toMatch(/^sch_/);

    const list = scheduler.list(session.id);
    expect(list).toHaveLength(1);
    expect(list[0].cronExpr).toBe("0 9 * * 1-5");
  });

  it("pauses and resumes schedules", () => {
    const events = new EventStore(db);
    const sessions = new SessionStore(db, events);
    const session = sessions.createSession({ title: "T", agentType: "claude", workspacePath: "/tmp" });

    const scheduler = new SchedulerService(db);
    const schedule = scheduler.create({ sessionId: session.id, kind: "once", runAt: new Date(Date.now() + 3600_000).toISOString() });

    scheduler.pause(schedule.id);
    const paused = scheduler.list(session.id);
    expect(paused[0].status).toBe("paused");

    scheduler.resume(schedule.id);
    const resumed = scheduler.list(session.id);
    expect(resumed[0].status).toBe("active");
  });

  it("records schedule run history", () => {
    const events = new EventStore(db);
    const sessions = new SessionStore(db, events);
    const session = sessions.createSession({ title: "T", agentType: "claude", workspacePath: "/tmp" });

    const scheduler = new SchedulerService(db);
    const schedule = scheduler.create({
      sessionId: session.id,
      kind: "once",
      runAt: new Date(Date.now() - 1000).toISOString(),
      payload: { text: "scheduled" },
    });

    const result = scheduler.runDue();
    expect(result.triggered).toHaveLength(1);

    const runs = scheduler.listRuns(schedule.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].taskId).toBe(result.triggered[0].taskId);
    expect(runs[0].taskStatus).toBe("queued");
    expect(runs[0].scheduledFor).toBe(schedule.nextRunAt);
    expect(runs[0].payloadSummary).toBe("scheduled");
  });
});

describe("ContextService", () => {
  it("compacts session context", () => {
    const context = new ContextService(db);
    const events = new EventStore(db);
    const sessions = new SessionStore(db, events);
    const session = sessions.createSession({ title: "T", agentType: "claude", workspacePath: "/tmp" });

    // Add some events
    events.append({ sessionId: session.id, type: "message", payload: { text: "hi" } });
    events.append({ sessionId: session.id, type: "message", payload: { text: "bye" } });

    const result = context.compact(session.id);
    expect(result.contextPackId).toMatch(/^ctx_/);
    expect(result.eventId).toMatch(/^evt_/);
  });

  it("restarts session after compact", () => {
    const context = new ContextService(db);
    const events = new EventStore(db);
    const sessions = new SessionStore(db, events);
    const session = sessions.createSession({ title: "T", agentType: "claude", workspacePath: "/tmp" });

    const { contextPackId } = context.compact(session.id);
    const result = context.restart(session.id);
    expect(result.taskId).toMatch(/^tsk_/);
  });
});

describe("Outbox enqueue flow (supervisor)", () => {
  // splitChunks is module-scoped, replicate logic for testing
  function splitChunks(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > 0) {
      if (rest.length <= maxLen) { chunks.push(rest); break; }
      let cut = rest.lastIndexOf("\n", maxLen);
      if (cut < maxLen * 0.5) cut = maxLen;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    return chunks;
  }

  it("splits long text into chunks per channel limits", () => {
    const long = "a\n".repeat(3000); // 6000 chars
    const chunks = splitChunks(long, 2000);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    expect(chunks.join("")).toBe(long);
  });

  it("splitChunks returns single chunk for short text", () => {
    const chunks = splitChunks("short text", 4096);
    expect(chunks).toEqual(["short text"]);
  });
});
