import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/http/app.js";
import { EventStore } from "../../src/server/events/event-store.js";
import { MessageProjector, WebOutboxProjector } from "../../src/server/events/projectors.js";
import { ClaudeRuntimeAdapter } from "../../src/server/runtime/adapters/claude-adapter.js";
import { CodexRuntimeAdapter } from "../../src/server/runtime/adapters/codex-adapter.js";
import { TraeRuntimeAdapter } from "../../src/server/runtime/adapters/trae-adapter.js";
import type { CommandResult, CommandRunner } from "../../src/server/runtime/command-runner.js";
import type {
  RuntimeDriverCallbacks,
  RuntimeDriverStartContext,
  RuntimeRunHandle,
  RuntimeSessionDriver,
} from "../../src/server/runtime/driver.js";
import type { RuntimeProcess, RuntimeProcessExit, RuntimeProcessFactory } from "../../src/server/runtime/process.js";
import { RuntimeAdapterRegistry } from "../../src/server/runtime/registry.js";
import type {
  AgentProbeResult,
  RuntimeCapabilities,
  RuntimeErrorClassification,
  RuntimeInput,
  RuntimeLaunchContext,
  RuntimeLaunchSpec,
  RuntimeOutputChunk,
} from "../../src/server/runtime/types.js";
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
        workspaceAllowlist: ["/tmp"],
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

      const confirmationResponse = await app.request("/api/security/confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_archive",
          resourceType: "memory_archive",
          resourceId: "mem-1",
          riskLevel: "high",
          prompt: "Confirm archive deletion",
          payload: { archiveDate: "2026-05-13" },
        }),
      });
      expect(confirmationResponse.status).toBe(201);
      const confirmation = await confirmationResponse.json();
      expect(confirmation).toMatchObject({
        confirmation: {
          id: expect.any(String),
          action: "delete_archive",
          resourceType: "memory_archive",
          status: "pending",
        },
        token: expect.any(String),
      });

      const confirmResponse = await app.request(
        `/api/security/confirmations/${confirmation.confirmation.id}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: confirmation.token }),
        },
      );
      expect(confirmResponse.status).toBe(200);
      await expect(confirmResponse.json()).resolves.toMatchObject({
        confirmation: {
          id: confirmation.confirmation.id,
          status: "confirmed",
        },
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

      const toolsResponse = await app.request("/api/mcp/tools");
      await expect(toolsResponse.json()).resolves.toMatchObject({
        tools: expect.arrayContaining([expect.objectContaining({ name: "events.query" })]),
      });

      const toolCallResponse = await app.request("/api/mcp/tools/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "events.query",
          args: { sessionId: "session-1", afterGlobalSeq: 0, limit: 2 },
        }),
      });
      expect(toolCallResponse.status).toBe(200);
      await expect(toolCallResponse.json()).resolves.toMatchObject({
        name: "events.query",
        result: expect.arrayContaining([expect.objectContaining({ sessionId: "session-1" })]),
      });

      const createSessionResponse = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Trae session",
          agentType: "trae",
          runtimeKind: "acp",
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
      const createdRow = testDb.db
        .prepare("SELECT default_params_json FROM sessions WHERE id = ?")
        .get(createdSession.sessionId) as { default_params_json: string };
      expect(JSON.parse(createdRow.default_params_json)).toMatchObject({ runtimeKind: "acp" });

      const invalidCreateSessionResponse = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType: "unknown" }),
      });
      expect(invalidCreateSessionResponse.status).toBe(400);

      const deniedCreateSessionResponse = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType: "codex", workspacePath: "/etc" }),
      });
      expect(deniedCreateSessionResponse.status).toBe(403);
      const deniedAudit = testDb.db.prepare("SELECT action FROM audit_logs WHERE action = 'workspace_denied'").get();
      expect(deniedAudit).toEqual({ action: "workspace_denied" });

      const setDefaultResponse = await app.request("/api/agent-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType: "workspace",
          scopeRef: "/tmp/default-workspace",
          agentType: "claude",
          params: { runtimeKind: "acp" },
        }),
      });
      expect(setDefaultResponse.status).toBe(201);
      await expect(setDefaultResponse.json()).resolves.toMatchObject({
        default: {
          scopeType: "workspace",
          scopeRef: "/tmp/default-workspace",
          agentType: "claude",
          params: { runtimeKind: "acp" },
        },
      });

      const resolveDefaultResponse = await app.request(
        "/api/agent-defaults/resolve?workspacePath=%2Ftmp%2Fdefault-workspace",
      );
      await expect(resolveDefaultResponse.json()).resolves.toMatchObject({
        default: {
          scopeType: "workspace",
          agentType: "claude",
        },
      });

      const defaultedSessionResponse = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Defaulted session",
          workspacePath: "/tmp/default-workspace",
        }),
      });
      expect(defaultedSessionResponse.status).toBe(201);
      const defaultedSession = await defaultedSessionResponse.json();
      expect(defaultedSession.workspace.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: defaultedSession.sessionId,
            agentType: "claude",
          }),
        ]),
      );
      const defaultedRow = testDb.db
        .prepare("SELECT default_params_json FROM sessions WHERE id = ?")
        .get(defaultedSession.sessionId) as { default_params_json: string };
      expect(JSON.parse(defaultedRow.default_params_json)).toMatchObject({ runtimeKind: "acp" });

      const replayResponse = await app.request("/api/events?sessionId=session-1&afterGlobalSeq=2&limit=2");
      const replay = await replayResponse.json();
      expect(replay.events.map((event: { type: string }) => event.type)).toEqual(["text_delta", "run_finished"]);

      const invalid = await app.request("/api/events?afterGlobalSeq=-1");
      expect(invalid.status).toBe(400);

      const eventStreamResponse = await app.request("/api/events/stream?sessionId=session-1&afterGlobalSeq=2&limit=2");
      expect(eventStreamResponse.headers.get("Content-Type")).toContain("text/event-stream");
      const eventStream = await eventStreamResponse.text();
      expect(eventStream).toContain("id: 3");
      expect(eventStream).toContain("event: text_delta");
      expect(eventStream).toContain("event: run_finished");
      expect(eventStream).toContain(": cursor-ready");

      testDb.db
        .prepare("UPDATE events SET created_at = '2026-05-13T09:00:00.000Z' WHERE session_id = 'session-1'")
        .run();
      const archiveResponse = await app.request("/api/sessions/session-1/memory/archives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archiveDate: "2026-05-13" }),
      });
      expect(archiveResponse.status).toBe(201);
      await expect(archiveResponse.json()).resolves.toMatchObject({
        archive: {
          sessionId: "session-1",
          archiveDate: "2026-05-13",
          summary: {
            eventCount: expect.any(Number),
          },
        },
        eventId: expect.any(String),
      });

      const archivesResponse = await app.request("/api/sessions/session-1/memory/archives");
      await expect(archivesResponse.json()).resolves.toMatchObject({
        archives: [expect.objectContaining({ sessionId: "session-1", archiveDate: "2026-05-13" })],
      });

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

      const createScheduleResponse = await app.request("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          kind: "once",
          runAt: "2026-05-13T00:10:00.000Z",
          payload: {
            taskType: "message",
            input: { text: "Scheduled follow up" },
          },
          actorType: "web_user",
          actorRef: "user-1",
        }),
      });
      expect(createScheduleResponse.status).toBe(201);

      const createdSchedule = await createScheduleResponse.json();
      expect(createdSchedule.schedule).toMatchObject({
        id: expect.any(String),
        sessionId: "session-1",
        kind: "once",
        status: "active",
        nextRunAt: "2026-05-13T00:10:00.000Z",
      });

      const listSchedulesResponse = await app.request("/api/schedules?sessionId=session-1");
      const schedules = await listSchedulesResponse.json();
      expect(schedules.schedules).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: createdSchedule.schedule.id })]),
      );

      const runDueResponse = await app.request("/api/schedules/due/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: "worker-1",
          now: "2026-05-13T00:10:00.000Z",
        }),
      });
      expect(runDueResponse.status).toBe(200);

      const runDue = await runDueResponse.json();
      expect(runDue.triggered).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            schedule: expect.objectContaining({
              id: createdSchedule.schedule.id,
              nextRunAt: null,
            }),
            taskId: expect.any(String),
          }),
        ]),
      );
      expect(runDue.workspace.keyEvents.at(-1)).toMatchObject([expect.any(String), "task_created", "system"]);

      const createCronResponse = await app.request("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          kind: "cron",
          cronExpr: "*/5 * * * *",
        }),
      });
      expect(createCronResponse.status).toBe(201);
      const createdCron = await createCronResponse.json();

      const pauseScheduleResponse = await app.request(`/api/schedules/${createdCron.schedule.id}/pause`, {
        method: "POST",
      });
      expect(pauseScheduleResponse.status).toBe(200);
      await expect(pauseScheduleResponse.json()).resolves.toMatchObject({
        schedule: { status: "paused" },
      });

      const resumeScheduleResponse = await app.request(`/api/schedules/${createdCron.schedule.id}/resume`, {
        method: "POST",
      });
      expect(resumeScheduleResponse.status).toBe(200);
      await expect(resumeScheduleResponse.json()).resolves.toMatchObject({
        schedule: { status: "active", nextRunAt: expect.any(String) },
      });

      const cancelScheduleResponse = await app.request(`/api/schedules/${createdCron.schedule.id}/cancel`, {
        method: "POST",
      });
      expect(cancelScheduleResponse.status).toBe(200);
      await expect(cancelScheduleResponse.json()).resolves.toMatchObject({
        schedule: { status: "cancelled" },
      });

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

      const restartContextResponse = await app.request("/api/sessions/session-1/context/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorType: "web_user" }),
      });
      expect(restartContextResponse.status).toBe(201);
      await expect(restartContextResponse.json()).resolves.toMatchObject({
        contextPackId: compact.contextPackId,
        taskId: expect.any(String),
        eventId: expect.any(String),
        workspace: expect.objectContaining({
          selectedSessionId: "session-1",
        }),
      });

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

      const feishuMessageResponse = await app.request("/api/feishu/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: "feishu-msg-1",
          chatId: "chat-1",
          userId: "feishu-user-1",
          text: "Start from Feishu",
          workspacePath: "/tmp/miniagent-feishu",
        }),
      });
      expect(feishuMessageResponse.status).toBe(201);

      const feishuMessage = await feishuMessageResponse.json();
      expect(feishuMessage).toMatchObject({
        result: {
          action: "message",
          session: {
            channelType: "feishu",
            channelRef: "chat-1",
          },
          task: {
            sourceType: "feishu",
            sourceRef: "feishu-msg-1",
          },
        },
      });
      expect(feishuMessage.workspace.outboxRows).toEqual(
        expect.arrayContaining([expect.arrayContaining(["Feishu"])]),
      );

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

  it("stops an active runtime run", async () => {
    const testDb = createTestDatabase();
    try {
      const eventStore = new EventStore(testDb.db);
      const sessionStore = new SessionStore(testDb.db, eventStore);
      sessionStore.createSession({
        id: "session-stop",
        title: "Stop session",
        agentType: "codex",
        workspacePath: "/tmp/miniagent-test",
      });
      sessionStore.createTask({
        id: "task-stop",
        sessionId: "session-stop",
        sourceType: "web",
        type: "message",
        input: { text: "keep running" },
      });

      const process = new HangingProcess();
      const app = createApp(testDb.db, {
        workspaceAllowlist: ["/tmp"],
        processFactory: { spawn: () => process },
        runtimeRegistry: new RuntimeAdapterRegistry([
          new CodexRuntimeAdapter({ commandRunner: runner({ exitCode: 0, stdout: "codex 1.0.0", stderr: "" }) }),
        ]),
      });

      const startResponse = await app.request("/api/sessions/session-stop/runs/start", { method: "POST" });
      const started = await startResponse.json();
      expect(startResponse.status).toBe(201);
      expect(started).toMatchObject({ status: "running", runId: expect.any(String) });

      const stopResponse = await app.request(`/api/runs/${started.runId}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorType: "web_user", actorRef: "user-1" }),
      });
      expect(stopResponse.status).toBe(200);
      await expect(stopResponse.json()).resolves.toMatchObject({
        runId: started.runId,
        status: "cancelled",
        workspace: {
          selectedSessionId: "session-stop",
        },
      });
      expect(process.stoppedSignal).toBe("SIGTERM");
    } finally {
      testDb.close();
    }
  });

  it("lists and responds to runtime permission requests", async () => {
    const testDb = createTestDatabase();
    try {
      const eventStore = new EventStore(testDb.db);
      const sessionStore = new SessionStore(testDb.db, eventStore);
      sessionStore.createSession({
        id: "session-permission",
        title: "Permission session",
        agentType: "codex",
        workspacePath: "/tmp/miniagent-test",
        defaultParams: { runtimeKind: "acp" },
      });
      sessionStore.createTask({
        id: "task-permission",
        sessionId: "session-permission",
        sourceType: "web",
        type: "message",
        input: { text: "edit file" },
      });

      const driver = new PermissionPromptDriver();
      const app = createApp(testDb.db, {
        workspaceAllowlist: ["/tmp"],
        processFactory: new IdleProcessFactory(),
        runtimeRegistry: new RuntimeAdapterRegistry([driver]),
      });

      const startResponse = await app.request("/api/sessions/session-permission/runs/start", { method: "POST" });
      const started = await startResponse.json();
      expect(startResponse.status).toBe(201);

      const listResponse = await app.request(`/api/runs/${started.runId}/permissions`);
      await expect(listResponse.json()).resolves.toMatchObject({
        permissions: [
          {
            requestId: "permission-http-1",
            status: "pending",
            options: [{ id: "allow", name: "Allow" }],
          },
        ],
      });

      const respondResponse = await app.request(`/api/runs/${started.runId}/permissions/permission-http-1/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: "selected", optionId: "allow" }),
      });

      expect(respondResponse.status).toBe(200);
      expect(driver.permissionResponse).toEqual({
        requestId: "permission-http-1",
        outcome: "selected",
        optionId: "allow",
      });
      await expect(respondResponse.json()).resolves.toMatchObject({
        permissions: [{ requestId: "permission-http-1", status: "approved", selectedOptionId: "allow" }],
      });
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

class HangingProcess implements RuntimeProcess {
  readonly pid = 6789;
  stoppedSignal: string | null = null;
  private exitHandler: ((exit: RuntimeProcessExit) => void) | null = null;

  write(): void {}

  stop(signal = "SIGTERM"): void {
    this.stoppedSignal = signal;
    this.exitHandler?.({
      exitCode: null,
      signal,
      message: signal,
      exitedAt: "2026-05-13T00:00:01.000Z",
    });
  }

  onOutput(): void {}

  onExit(handler: (exit: RuntimeProcessExit) => void): void {
    this.exitHandler = handler;
  }
}

class IdleProcessFactory implements RuntimeProcessFactory {
  spawn(): RuntimeProcess {
    return new HangingProcess();
  }
}

class PermissionPromptDriver implements RuntimeSessionDriver {
  readonly runtimeKind = "acp";
  readonly agentType = "codex";
  readonly displayName = "Codex ACP";
  readonly command = "fake-acp";
  permissionResponse: unknown = null;

  capabilities(): RuntimeCapabilities {
    return {
      textStreaming: true,
      structuredEvents: true,
      nativeCompact: false,
      resume: true,
      sessionExport: false,
      permissionPrompt: true,
      imageInput: false,
    };
  }

  async probe(): Promise<AgentProbeResult> {
    return {
      agentType: "codex",
      status: "healthy",
      command: this.command,
      version: "fake",
      message: null,
      checkedAt: "2026-05-14T00:00:00.000Z",
    };
  }

  createLaunchSpec(context: RuntimeLaunchContext): RuntimeLaunchSpec {
    return {
      agentType: "codex",
      runtimeKind: "acp",
      command: this.command,
      args: [],
      cwd: context.session.workspacePath,
      env: {},
      envSummary: {},
    };
  }

  classifyError(error: unknown): RuntimeErrorClassification {
    return {
      class: error instanceof Error && error.message.includes("cancel") ? "user_cancelled" : "process_crash",
      message: error instanceof Error ? error.message : "runtime error",
      retryable: false,
    };
  }

  start(
    _context: RuntimeDriverStartContext,
    _process: RuntimeProcess,
    callbacks: RuntimeDriverCallbacks,
  ): RuntimeRunHandle {
    return {
      sendInput: (_input: RuntimeInput) => {
        callbacks.emit({
          type: "permission_prompt",
          payload: {
            protocol: "acp",
            requestId: "permission-http-1",
            prompt: "Allow file edit?",
            options: [{ id: "allow", name: "Allow" }],
            toolCall: { toolCallId: "tool-1" },
            status: "waiting",
          },
        });
      },
      respondPermission: (input) => {
        this.permissionResponse = input;
        callbacks.exit({
          exitCode: 0,
          signal: null,
          message: "end_turn",
          exitedAt: "2026-05-14T00:00:01.000Z",
        });
      },
      stop: () => {},
      flush: () => [],
    };
  }
}

function readAuditActions(db: ReturnType<typeof createTestDatabase>["db"], sessionId: string): string[] {
  return db
    .prepare("SELECT action FROM audit_logs WHERE resource_type = 'session' AND resource_id = ? ORDER BY created_at ASC")
    .all(sessionId)
    .map((row) => (row as { action: string }).action);
}
