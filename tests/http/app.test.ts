import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/http/app.js";
import { EventStore } from "../../src/server/events/event-store.js";
import { MessageProjector, WebOutboxProjector } from "../../src/server/events/projectors.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase } from "../support/db.js";

describe("HTTP app", () => {
  it("serves health, workspace snapshot, and event replay endpoints", async () => {
    const testDb = createTestDatabase();
    try {
      const eventStore = new EventStore(testDb.db);
      const sessionStore = new SessionStore(testDb.db, eventStore);

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
        input: { text: "Hello MiniAgent" },
      });
      sessionStore.startRun({ id: "run-1", sessionId: "session-1", taskId: "task-1" });
      eventStore.append({
        id: "event-text",
        sessionId: "session-1",
        runId: "run-1",
        taskId: "task-1",
        type: "text_delta",
        payload: { text: "Hello from Codex" },
      });
      sessionStore.finishRun({ runId: "run-1", status: "succeeded" });

      new MessageProjector(testDb.db).projectNextBatch();
      new WebOutboxProjector(testDb.db).projectNextBatch();

      const app = createApp(testDb.db);

      const healthResponse = await app.request("/api/health");
      await expect(healthResponse.json()).resolves.toEqual({
        ok: true,
        service: "miniagent",
      });

      const workspaceResponse = await app.request("/api/workspace");
      const workspace = await workspaceResponse.json();
      expect(workspace.sessions[0]).toMatchObject({
        id: "session-1",
        title: "Codex session",
        agentType: "codex",
        agent: "Codex",
        status: "idle",
      });
      expect(workspace.messages.map((message: { markdown: string }) => message.markdown)).toContain("Hello from Codex");
      expect(workspace.outboxRows).toHaveLength(4);
      expect(workspace.keyEvents.at(-1)).toMatchObject(["4", "run_finished", "succeeded"]);

      const replayResponse = await app.request("/api/events?sessionId=session-1&afterGlobalSeq=2&limit=2");
      const replay = await replayResponse.json();
      expect(replay.events.map((event: { type: string }) => event.type)).toEqual(["text_delta", "run_finished"]);

      const invalid = await app.request("/api/events?afterGlobalSeq=-1");
      expect(invalid.status).toBe(400);

      const handoffResponse = await app.request("/api/sessions/session-1/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAgentType: "claude",
          actorType: "web_user",
          actorRef: "user-1",
        }),
      });
      expect(handoffResponse.status).toBe(201);

      const handoff = await handoffResponse.json();
      expect(handoff).toMatchObject({
        sourceContextPackId: expect.any(String),
        requestedEventId: expect.any(String),
        createdEventId: expect.any(String),
      });
      expect(handoff.workspace.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: handoff.targetSessionId,
            agentType: "claude",
            agent: "Claude",
            handoff: "session-1",
          }),
        ]),
      );

      const sameAgentResponse = await app.request("/api/sessions/session-1/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetAgentType: "codex" }),
      });
      expect(sameAgentResponse.status).toBe(400);

      const invalidAgentResponse = await app.request("/api/sessions/session-1/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetAgentType: "unknown" }),
      });
      expect(invalidAgentResponse.status).toBe(400);

      const missingSessionResponse = await app.request("/api/sessions/missing/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetAgentType: "claude" }),
      });
      expect(missingSessionResponse.status).toBe(404);
    } finally {
      testDb.close();
    }
  });
});
