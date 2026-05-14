import { afterEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/server/events/event-store.js";
import type { RuntimeProcess, RuntimeProcessExit, RuntimeProcessFactory } from "../../src/server/runtime/process.js";
import { RuntimeAdapterRegistry } from "../../src/server/runtime/registry.js";
import { RuntimeSupervisor } from "../../src/server/runtime/runtime-supervisor.js";
import { PermissionRequestStore } from "../../src/server/runtime/permission-request-store.js";
import type { RuntimeLaunchSpec, RuntimeOutputChunk } from "../../src/server/runtime/types.js";
import { AcpRuntimeDriver } from "../../src/server/runtime/drivers/acp-runtime-driver.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import type { JsonObject, JsonValue } from "../../src/shared/json.js";
import { createTestDatabase } from "../support/db.js";

describe("AcpRuntimeDriver", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("streams ACP session updates into EventStore and finishes the run", async () => {
    const fixture = createAcpSupervisorFixture();
    const started = fixture.supervisor.startTask({ sessionId: "session-1", taskId: "task-1" });

    fixture.supervisor.sendInput(started.run.id, { taskType: "message", input: { text: "hello ACP" } });

    await eventually(() => {
      expect(fixture.sessionStore.getRun(started.run.id)).toMatchObject({ status: "succeeded" });
    });

    expect(fixture.factory.spawnedSpec).toMatchObject({ runtimeKind: "acp", command: "fake-acp-agent" });
    expect(fixture.process.methods()).toEqual(["initialize", "session/new", "session/prompt"]);
    const prompt = fixture.process.message("session/prompt")?.params as JsonObject;
    expect(prompt.prompt).toEqual([{ type: "text", text: "hello ACP" }]);

    const events = fixture.eventStore.listAfterGlobalSeq({ afterGlobalSeq: 0 });
    expect(events.map((event) => event.type)).toEqual([
      "task_created",
      "run_started",
      "acp_session_started",
      "text_delta",
      "run_finished",
    ]);
    expect(events[3].payload).toMatchObject({ text: "streamed from ACP", protocol: "acp" });
    expect(fixture.sessionStore.getRun(started.run.id)).toMatchObject({
      runtimeKind: "acp",
      externalSessionId: "acp-session-1",
    });
  });

  it("sends session/cancel and maps cancelled stop reasons to cancelled runs", async () => {
    const fixture = createAcpSupervisorFixture({ holdPromptUntilCancel: true });
    const started = fixture.supervisor.startTask({ sessionId: "session-1", taskId: "task-1" });

    fixture.supervisor.sendInput(started.run.id, { taskType: "message", input: { text: "long task" } });
    await eventually(() => {
      expect(fixture.process.methods()).toContain("session/prompt");
    });

    fixture.supervisor.stop(started.run.id);

    await eventually(() => {
      expect(fixture.sessionStore.getRun(started.run.id)).toMatchObject({ status: "cancelled" });
    });

    expect(fixture.process.methods()).toContain("session/cancel");
    expect(fixture.eventStore.listAfterGlobalSeq({ afterGlobalSeq: 0 }).map((event) => event.type)).toContain(
      "acp_cancel_requested",
    );
    expect(fixture.sessionStore.getRun(started.run.id)).toMatchObject({ cancelState: "acknowledged" });
  });

  it("keeps ACP permission requests pending until MiniAgent responds", async () => {
    const fixture = createAcpSupervisorFixture({ requestPermission: true });
    const started = fixture.supervisor.startTask({ sessionId: "session-1", taskId: "task-1" });

    fixture.supervisor.sendInput(started.run.id, { taskType: "message", input: { text: "edit file" } });
    await eventually(() => {
      expect(
        fixture.eventStore.listAfterGlobalSeq({ afterGlobalSeq: 0 }).some((event) => event.type === "permission_prompt"),
      ).toBe(true);
    });
    expect(fixture.permissionRequests.listByRun(started.run.id)).toMatchObject([
      { acpRequestId: "permission-1", status: "pending" },
    ]);
    expect(fixture.sessionStore.getRun(started.run.id)).toMatchObject({ status: "waiting_permission" });

    fixture.supervisor.respondPermission(started.run.id, {
      requestId: "permission-1",
      outcome: "selected",
      optionId: "allow",
    });

    await eventually(() => {
      expect(fixture.sessionStore.getRun(started.run.id)).toMatchObject({ status: "succeeded" });
    });

    const permissionResponse = fixture.process.response("permission-1");
    expect(permissionResponse?.result).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
    expect(fixture.permissionRequests.listByRun(started.run.id)).toMatchObject([
      { acpRequestId: "permission-1", status: "approved", selectedOptionId: "allow" },
    ]);
  });

  it("uses ACP resume and resource links when provided by the task input", async () => {
    const fixture = createAcpSupervisorFixture();
    fixture.sessionStore.createTask({
      id: "task-resume",
      sessionId: "session-1",
      sourceType: "system",
      type: "resume",
      input: {
        text: "continue",
        externalSessionId: "previous-acp-session",
        files: ["/tmp/miniagent-test/src/app.ts"],
      },
    });
    const started = fixture.supervisor.startTask({ sessionId: "session-1", taskId: "task-resume" });

    fixture.supervisor.sendInput(started.run.id, {
      taskType: "resume",
      input: {
        text: "continue",
        externalSessionId: "previous-acp-session",
        files: ["/tmp/miniagent-test/src/app.ts"],
      },
    });

    await eventually(() => {
      expect(fixture.sessionStore.getRun(started.run.id)).toMatchObject({ status: "succeeded" });
    });

    expect(fixture.process.methods()).toContain("session/resume");
    const prompt = fixture.process.message("session/prompt")?.params as JsonObject;
    expect(prompt.prompt).toEqual([
      { type: "text", text: "continue" },
      {
        type: "resource_link",
        uri: "file:///tmp/miniagent-test/src/app.ts",
        name: "app.ts",
        mimeType: "text/plain",
      },
    ]);
  });

  function createAcpSupervisorFixture(options: FakeAcpProcessOptions = {}) {
    const testDb = createTestDatabase();
    cleanup = testDb.close;
    const eventStore = new EventStore(testDb.db);
    const sessionStore = new SessionStore(testDb.db, eventStore);
    sessionStore.createSession({
      id: "session-1",
      title: "ACP session",
      agentType: "codex",
      workspacePath: "/tmp/miniagent-test",
    });
    sessionStore.createTask({
      id: "task-1",
      sessionId: "session-1",
      sourceType: "web",
      type: "message",
      input: { text: "hello" },
    });

    const process = new FakeAcpProcess(options);
    const factory = new FakeProcessFactory(process);
    const permissionRequests = new PermissionRequestStore(testDb.db);
    const supervisor = new RuntimeSupervisor({
      adapterRegistry: new RuntimeAdapterRegistry([
        new AcpRuntimeDriver({
          agentType: "codex",
          displayName: "Codex ACP",
          command: "fake-acp-agent",
        }),
      ]),
      eventStore,
      permissionRequestStore: permissionRequests,
      sessionStore,
      processFactory: factory,
      maxTextDeltaBytes: 10_000,
    });

    return { eventStore, factory, permissionRequests, process, sessionStore, supervisor };
  }
});

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: JsonValue;
  result?: JsonValue;
};

type FakeAcpProcessOptions = {
  holdPromptUntilCancel?: boolean;
  requestPermission?: boolean;
};

class FakeProcessFactory implements RuntimeProcessFactory {
  spawnedSpec: RuntimeLaunchSpec | null = null;

  constructor(private readonly process: FakeAcpProcess) {}

  spawn(spec: RuntimeLaunchSpec): RuntimeProcess {
    this.spawnedSpec = spec;
    return this.process;
  }
}

class FakeAcpProcess implements RuntimeProcess {
  readonly pid = 5432;
  stoppedSignal: string | null = null;
  private readonly outputHandlers = new Set<(chunk: RuntimeOutputChunk) => void>();
  private readonly exitHandlers = new Set<(exit: RuntimeProcessExit) => void>();
  private readonly messages: JsonRpcMessage[] = [];
  private readonly responses: JsonRpcMessage[] = [];
  private buffer = "";
  private pendingPromptId: string | number | null = null;

  constructor(private readonly options: FakeAcpProcessOptions) {}

  write(input: string): void {
    this.buffer += input;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        this.handleMessage(JSON.parse(line) as JsonRpcMessage);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  stop(signal = "SIGTERM"): void {
    this.stoppedSignal = signal;
  }

  onOutput(handler: (chunk: RuntimeOutputChunk) => void): void {
    this.outputHandlers.add(handler);
  }

  onExit(handler: (exit: RuntimeProcessExit) => void): void {
    this.exitHandlers.add(handler);
  }

  methods(): string[] {
    return this.messages.map((message) => message.method).filter((method): method is string => Boolean(method));
  }

  message(method: string): JsonRpcMessage | null {
    return this.messages.find((message) => message.method === method) ?? null;
  }

  response(id: string): JsonRpcMessage | null {
    return this.responses.find((message) => String(message.id) === id) ?? null;
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (!message.method) {
      this.responses.push(message);
      if (String(message.id) === "permission-1" && this.pendingPromptId !== null) {
        this.sendTextDelta();
        this.send({ jsonrpc: "2.0", id: this.pendingPromptId, result: { stopReason: "end_turn" } });
        this.pendingPromptId = null;
      }
      return;
    }

    this.messages.push(message);
    switch (message.method) {
      case "initialize":
        this.send({ jsonrpc: "2.0", id: responseId(message), result: { protocolVersion: 1, agentCapabilities: {} } });
        break;
      case "session/new":
        this.send({ jsonrpc: "2.0", id: responseId(message), result: { sessionId: "acp-session-1" } });
        break;
      case "session/resume":
        this.send({ jsonrpc: "2.0", id: responseId(message), result: {} });
        break;
      case "session/prompt":
        this.handlePrompt(message);
        break;
      case "session/cancel":
        if (this.pendingPromptId !== null) {
          this.send({ jsonrpc: "2.0", id: this.pendingPromptId, result: { stopReason: "cancelled" } });
          this.pendingPromptId = null;
        }
        break;
    }
  }

  private handlePrompt(message: JsonRpcMessage): void {
    this.pendingPromptId = message.id ?? null;
    if (this.options.requestPermission) {
      this.send({
        jsonrpc: "2.0",
        id: "permission-1",
        method: "session/request_permission",
        params: {
          sessionId: "acp-session-1",
          options: [{ id: "allow", kind: "allow_once", name: "Allow" }],
          toolCall: { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "pending" },
        },
      });
      return;
    }

    if (this.options.holdPromptUntilCancel) {
      return;
    }

    this.sendTextDelta();
    this.send({ jsonrpc: "2.0", id: responseId(message), result: { stopReason: "end_turn" } });
    this.pendingPromptId = null;
  }

  private sendTextDelta(): void {
    this.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "acp-session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "streamed from ACP" },
        },
      },
    });
  }

  private send(message: JsonRpcMessage): void {
    const text = `${JSON.stringify(message)}\n`;
    for (const handler of this.outputHandlers) {
      handler({ stream: "stdout", text, receivedAt: "2026-05-14T00:00:00.000Z" });
    }
  }
}

function responseId(message: JsonRpcMessage): string | number {
  if (typeof message.id === "string" || typeof message.id === "number") {
    return message.id;
  }
  throw new Error("JSON-RPC request id is required");
}

async function eventually(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 1_000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}
