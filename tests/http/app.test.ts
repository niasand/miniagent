import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/http/app.js";
import { EventStore } from "../../src/server/events/event-store.js";
import { MessageProjector, WebOutboxProjector } from "../../src/server/events/projectors.js";
import { ClaudeRuntimeAdapter } from "../../src/server/runtime/adapters/claude-adapter.js";
import { CodexRuntimeAdapter } from "../../src/server/runtime/adapters/codex-adapter.js";
import { TraeRuntimeAdapter } from "../../src/server/runtime/adapters/trae-adapter.js";
import type { CommandResult, CommandRunner } from "../../src/server/runtime/command-runner.js";
import type { RuntimeProcess, RuntimeProcessExit, RuntimeProcessFactory } from "../../src/server/runtime/process.js";
import { RuntimeAdapterRegistry } from "../../src/server/runtime/registry.js";
import type { RuntimeOutputChunk } from "../../src/server/runtime/types.js";
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

      const app = createApp(testDb.db, {
        defaultWorkspacePath: "/tmp/miniagent-default",
        processFactory: new EchoProcessFactory(),
        runtimeRegistry: new RuntimeAdapterRegistry([
          new CodexRuntimeAdapter({ commandRunner: runner({ exitCode: 0, stdout: "codex 1.0.0", stderr: "" }) }),
          new ClaudeRuntimeAdapter({
            commandRunner: runner({ exitCode: 1, stdout: "", stderr: "authentication required" }),
          }),
          new TraeRuntimeAdapter({
            commandRunner: runner({
              exitCode: null,
              stdout: "",
              stderr: "",
              errorCode: "ENOENT",
              errorMessage: "not found",
            }),
          }),
        ]),
      });

      const healthResponse = await app.request("/api/health");
      await expect(healthResponse.json()).resolves.toEqual({
        ok: true,
        service: "miniagent",
      });

      const rootResponse = await app.request("/");
      await expect(rootResponse.json()).resolves.toMatchObject({
        ok: true,
        service: "miniagent",
        ui: "http://127.0.0.1:7272/",
        endpoints: expect.arrayContaining(["/api/health", "/api/workspace", "/api/agents"]),
      });

      const agentsResponse = await app.request("/api/agents");
      const agents = await agentsResponse.json();
      expect(agents.agents.map((agent: { agentType: string; status: string }) => [agent.agentType, agent.status])).toEqual([
        ["codex", "healthy"],
        ["claude", "auth_required"],
        ["trae", "missing"],
      ]);

      const workspaceResponse = await app.request("/api/workspace");
      const workspace = await workspaceResponse.json();
      expect(workspace.selectedSessionId).toBe("session-1");
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

      sessionStore.createSession({
        id: "session-2",
        title: "Claude session",
        agentType: "claude",
        workspacePath: "/tmp/miniagent-test",
      });
      const selectedWorkspaceResponse = await app.request("/api/workspace?sessionId=session-1");
      const selectedWorkspace = await selectedWorkspaceResponse.json();
      expect(selectedWorkspace.selectedSessionId).toBe("session-1");
      expect(selectedWorkspace.messages.map((message: { markdown: string }) => message.markdown)).toContain(
        "Hello from Codex",
      );

      const createSessionResponse = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Trae session",
          agentType: "trae",
          workspacePath: "/tmp/miniagent-new",
        }),
      });
      expect(createSessionResponse.status).toBe(201);

      const createdSession = await createSessionResponse.json();
      expect(createdSession.workspace).toMatchObject({
        selectedSessionId: createdSession.sessionId,
      });
      expect(createdSession.workspace.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: createdSession.sessionId,
            title: "Trae session",
            agentType: "trae",
            workspace: "/tmp/miniagent-new",
          }),
        ]),
      );

      const invalidCreateSessionResponse = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType: "unknown" }),
      });
      expect(invalidCreateSessionResponse.status).toBe(400);

      const replayResponse = await app.request("/api/events?sessionId=session-1&afterGlobalSeq=2&limit=2");
      const replay = await replayResponse.json();
      expect(replay.events.map((event: { type: string }) => event.type)).toEqual(["text_delta", "run_finished"]);

      const invalid = await app.request("/api/events?afterGlobalSeq=-1");
      expect(invalid.status).toBe(400);

      const messageResponse = await app.request("/api/sessions/session-1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "  Follow up on the migration  " }),
      });
      expect(messageResponse.status).toBe(201);

      const message = await messageResponse.json();
      expect(message).toMatchObject({
        taskId: expect.any(String),
        eventId: expect.any(String),
        workspace: expect.objectContaining({
          selectedSessionId: "session-1",
        }),
      });
      expect(message.workspace.messages.map((item: { markdown: string }) => item.markdown)).toContain(
        "Follow up on the migration",
      );

      const startRunResponse = await app.request("/api/sessions/session-1/runs/start", {
        method: "POST",
      });
      expect(startRunResponse.status).toBe(201);

      const started = await startRunResponse.json();
      expect(started).toMatchObject({
        taskId: message.taskId,
        runId: expect.any(String),
        status: "succeeded",
        workspace: expect.objectContaining({
          selectedSessionId: "session-1",
        }),
      });
      expect(started.workspace.messages.map((item: { markdown: string }) => item.markdown)).toContain(
        "echo: Follow up on the migration",
      );
      expect(started.workspace.contextBudget).toMatchObject({
        status: expect.any(String),
        tokenEstimate: expect.any(Number),
        budgetTokens: 100_000,
      });

      const noQueuedRunResponse = await app.request("/api/sessions/session-1/runs/start", {
        method: "POST",
      });
      expect(noQueuedRunResponse.status).toBe(409);

      const compactResponse = await app.request("/api/sessions/session-1/context/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorType: "web_user",
          budgetTokens: 1_000,
        }),
      });
      expect(compactResponse.status).toBe(201);

      const compact = await compactResponse.json();
      expect(compact).toMatchObject({
        contextPackId: expect.any(String),
        eventId: expect.any(String),
        contextBudget: expect.objectContaining({
          currentContextPackId: expect.any(String),
          budgetTokens: 1_000,
        }),
        workspace: expect.objectContaining({
          selectedSessionId: "session-1",
        }),
      });
      expect(readAuditActions(testDb.db, "session-1")).toContain("compact");

      const emptyMessageResponse = await app.request("/api/sessions/session-1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: " " }),
      });
      expect(emptyMessageResponse.status).toBe(400);

      const missingMessageSessionResponse = await app.request("/api/sessions/missing/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello" }),
      });
      expect(missingMessageSessionResponse.status).toBe(404);

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

      const missingCompactSessionResponse = await app.request("/api/sessions/missing/context/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorType: "web_user" }),
      });
      expect(missingCompactSessionResponse.status).toBe(404);
    } finally {
      testDb.close();
    }
  });
});

function runner(result: CommandResult): CommandRunner {
  return {
    run: () => result,
  };
}

class EchoProcessFactory implements RuntimeProcessFactory {
  spawn(): RuntimeProcess {
    return new EchoProcess();
  }
}

class EchoProcess implements RuntimeProcess {
  readonly pid = 12345;
  private outputHandler: ((chunk: RuntimeOutputChunk) => void) | null = null;
  private exitHandler: ((exit: RuntimeProcessExit) => void) | null = null;

  write(input: string): void {
    this.outputHandler?.({
      stream: "stdout",
      text: `echo: ${input.trim()}`,
      receivedAt: "2026-05-13T00:00:00.000Z",
    });
    this.exitHandler?.({
      exitCode: 0,
      signal: null,
      message: null,
      exitedAt: "2026-05-13T00:00:01.000Z",
    });
  }

  stop(signal = "SIGTERM"): void {
    this.exitHandler?.({
      exitCode: null,
      signal,
      message: signal,
      exitedAt: "2026-05-13T00:00:01.000Z",
    });
  }

  onOutput(handler: (chunk: RuntimeOutputChunk) => void): void {
    this.outputHandler = handler;
  }

  onExit(handler: (exit: RuntimeProcessExit) => void): void {
    this.exitHandler = handler;
  }
}

function readAuditActions(db: ReturnType<typeof createTestDatabase>["db"], sessionId: string): string[] {
  return db
    .prepare("SELECT action FROM audit_logs WHERE resource_type = 'session' AND resource_id = ? ORDER BY created_at ASC")
    .all(sessionId)
    .map((row) => (row as { action: string }).action);
}
