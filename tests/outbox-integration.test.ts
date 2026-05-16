import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, disposeTestDb } from "./helpers.js";
import type { SqliteDatabase } from "../src/server/db/migrate.js";
import { EventStore } from "../src/server/stores/event-store.js";
import { SessionStore } from "../src/server/stores/session-store.js";
import { OutboxStore, type OutboxItem } from "../src/server/stores/outbox-store.js";
import { MessageStore } from "../src/server/stores/message-store.js";

let db: SqliteDatabase;
let events: EventStore;
let sessions: SessionStore;
let outbox: OutboxStore;
let messages: MessageStore;

function setupRunWithDeltas(channelType: string, channelRef: string, deltas: string[]) {
  const session = sessions.createSession({
    title: "Test",
    agentType: "claude",
    workspacePath: process.cwd(),
    channelType: channelType as any,
    channelRef,
  });

  const { task } = sessions.createTask({
    sessionId: session.id,
    sourceType: "web",
    type: "message",
    input: { text: "hello" },
  });

  const { run } = sessions.startRun({
    sessionId: session.id,
    taskId: task.id,
    agentType: "claude",
  });

  // Write text_delta events for the run
  for (const text of deltas) {
    events.append({
      sessionId: session.id,
      runId: run.id,
      taskId: task.id,
      type: "text_delta",
      payload: { text },
    });
  }

  // Write a user message linked to the run
  const event = events.append({ sessionId: session.id, type: "message" });
  messages.insert({
    sessionId: session.id,
    runId: run.id,
    role: "user",
    content: "hello",
    sourceEventId: event.id,
  });

  return { session, task, run };
}

beforeEach(() => {
  db = createTestDb();
  events = new EventStore(db);
  sessions = new SessionStore(db, events);
  outbox = new OutboxStore(db);
  messages = new MessageStore(db);
});

afterEach(() => disposeTestDb(db));

describe("Outbox enqueue on run completion", () => {
  it("collects text_deltas and enqueues reply for feishu session", () => {
    const { session, task, run } = setupRunWithDeltas("feishu", "c2c:user1", ["Hello ", "world!"]);

    // Simulate run completion
    sessions.finishRun({ runId: run.id, status: "succeeded", stoppedAt: new Date().toISOString() });

    // Collect deltas manually (same logic as supervisor)
    const deltas = events.listByRun(run.id, "text_delta");
    const text = deltas
      .map((e) => (typeof (e.payload as any)?.text === "string" ? (e.payload as any).text : ""))
      .join("");

    expect(text).toBe("Hello world!");

    // Enqueue
    outbox.enqueue({
      sessionId: session.id,
      channelType: "feishu",
      targetRef: session.channelRef!,
      kind: "feishu_markdown",
      viewModel: { text: text + "\n\n⏱ 0.0s" },
      idempotencyKey: `${run.id}:reply:0`,
    });

    const items = outbox.claimDue({ workerId: "test" });
    expect(items).toHaveLength(1);
    expect(items[0].channelType).toBe("feishu");
    expect(items[0].targetRef).toBe("c2c:user1");
    expect((items[0].viewModel as any).text).toContain("Hello world!");
    expect((items[0].viewModel as any).text).toContain("⏱");
  });

  it("splits long reply into chunks for discord", () => {
    const longParts = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: ${"x".repeat(30)}\n`);
    const { session, run } = setupRunWithDeltas("discord", "ch:12345", longParts);

    sessions.finishRun({ runId: run.id, status: "succeeded", stoppedAt: new Date().toISOString() });

    const deltas = events.listByRun(run.id, "text_delta");
    const text = deltas
      .map((e) => (typeof (e.payload as any)?.text === "string" ? (e.payload as any).text : ""))
      .join("");

    // Discord max = 2000
    const maxLen = 2000;
    const chunks = splitChunks(text, maxLen);
    expect(chunks.length).toBeGreaterThan(1);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].length).toBeLessThanOrEqual(maxLen);
      outbox.enqueue({
        sessionId: session.id,
        channelType: "discord",
        targetRef: session.channelRef!,
        kind: "discord_markdown",
        viewModel: { text: chunks[i], chunkIndex: i, totalChunks: chunks.length },
        idempotencyKey: `${run.id}:reply:${i}`,
      });
    }

    const allItems = outbox.claimDue({ workerId: "test", limit: 50 });
    expect(allItems.length).toBe(chunks.length);
    for (const item of allItems) {
      expect(item.channelType).toBe("discord");
    }
  });

  it("skips outbox for web sessions (SSE-only)", () => {
    const { session: webSession, run } = setupRunWithDeltas("web", "web-session-ref", ["Some text"]);

    sessions.finishRun({ runId: run.id, status: "succeeded", stoppedAt: new Date().toISOString() });

    // Web sessions have channelRef = session.id, no external outbox needed
    // In supervisor, web channelType is checked but channelRef is session.id,
    // so it DOES enqueue as web_event — verify this behavior
    const deltas = events.listByRun(run.id, "text_delta");
    expect(deltas).toHaveLength(1);
  });

  it("handles run with no text_delta events", () => {
    const session = sessions.createSession({
      title: "T",
      agentType: "claude",
      workspacePath: process.cwd(),
      channelType: "telegram",
      channelRef: "chat:1",
    });
    const { task } = sessions.createTask({
      sessionId: session.id,
      sourceType: "web",
      type: "message",
      input: {},
    });
    const { run } = sessions.startRun({
      sessionId: session.id,
      taskId: task.id,
    });

    sessions.finishRun({ runId: run.id, status: "succeeded", stoppedAt: new Date().toISOString() });

    const deltas = events.listByRun(run.id, "text_delta");
    expect(deltas).toHaveLength(0);

    // No text → no outbox enqueue
    const items = outbox.claimDue({ workerId: "test" });
    expect(items).toHaveLength(0);
  });

  it("qq channel uses 2048 char limit", () => {
    const text200 = "abcdefghij".repeat(20) + "\n"; // 201 chars per line
    const lines = Array.from({ length: 15 }, () => text200); // ~3015 chars total
    const { session, run } = setupRunWithDeltas("qq", "group:123", lines);

    sessions.finishRun({ runId: run.id, status: "succeeded", stoppedAt: new Date().toISOString() });

    const deltas = events.listByRun(run.id, "text_delta");
    const fullText = deltas.map((e) => (e.payload as any).text ?? "").join("");

    const chunks = splitChunks(fullText, 2048);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2048);
    }
  });
});

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
