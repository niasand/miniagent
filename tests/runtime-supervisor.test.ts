import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, disposeTestDb } from "./helpers.js";
import type { SqliteDatabase } from "../src/server/db/migrate.js";
import { SessionStore, type SourceType } from "../src/server/stores/session-store.js";
import { EventStore } from "../src/server/stores/event-store.js";
import { MessageStore } from "../src/server/stores/message-store.js";
import { PermissionRequestStore } from "../src/server/stores/permission-request-store.js";
import { OutboxStore } from "../src/server/stores/outbox-store.js";
import { RuntimeSupervisor } from "../src/server/runtime/supervisor.js";
import { RuntimeAdapterRegistry } from "../src/server/runtime/registry.js";
import type {
  RuntimeSessionDriver,
  RuntimeRunHandle,
  RuntimeLaunchContext,
  RuntimeEventDraft,
  RuntimeDriverCallbacks,
  RuntimeDriverStartContext,
  RuntimePermissionResponseInput,
  AgentProbeResult,
  RuntimeErrorClassification,
  RuntimeLaunchSpec,
  RuntimeCapabilities,
  RuntimeInput,
} from "../src/server/runtime/types.js";
import type { RuntimeProcess, RuntimeProcessExit } from "../src/server/runtime/process.js";

// ── Fakes ────────────────────────────────────────────────────────────────

class FakeProcess implements RuntimeProcess {
  readonly pid = null;
  write() {}
  stop() {}
  onOutput() {}
  onExit() {}
}

class FakeProcessFactory {
  spawn(): RuntimeProcess {
    return new FakeProcess();
  }
}

/**
 * Fake driver that captures the callbacks so tests can emit events
 * and inspect whether respondPermission was called.
 */
class FakeDriver implements RuntimeSessionDriver {
  readonly runtimeKind = "acp" as const;
  readonly agentType = "claude" as const;
  readonly displayName = "Fake";
  readonly command = "fake-agent";
  private callbacks: RuntimeDriverCallbacks | null = null;
  private handle: FakeHandle | null = null;

  capabilities(): RuntimeCapabilities {
    return {
      textStreaming: true,
      structuredEvents: true,
      nativeCompact: false,
      resume: false,
      sessionExport: false,
      permissionPrompt: true,
      imageInput: false,
    };
  }

  async probe(): Promise<AgentProbeResult> {
    return { agentType: "claude", status: "healthy", command: "fake", version: null, message: null, checkedAt: new Date().toISOString() };
  }

  createLaunchSpec(context: RuntimeLaunchContext): RuntimeLaunchSpec {
    return {
      agentType: "claude",
      runtimeKind: "acp",
      command: "fake-agent",
      args: [],
      cwd: context.session.workspacePath,
      env: {},
      envSummary: {},
      protocolVersion: 1,
    };
  }

  classifyError(): RuntimeErrorClassification {
    return { class: "process_crash", message: "fake error", retryable: false };
  }

  start(
    _context: RuntimeDriverStartContext,
    _process: RuntimeProcess,
    callbacks: RuntimeDriverCallbacks,
  ): RuntimeRunHandle {
    this.callbacks = callbacks;
    this.handle = new FakeHandle();
    return this.handle;
  }

  /** Emit events as if the agent produced them. */
  emit(drafts: RuntimeEventDraft | RuntimeEventDraft[]): void {
    this.callbacks!.emit(drafts);
  }

  exit(exit: RuntimeProcessExit = { exitCode: 0, signal: null, message: null, exitedAt: new Date().toISOString() }): void {
    this.callbacks!.exit(exit);
  }

  get respondPermissionCalls(): RuntimePermissionResponseInput[] {
    return this.handle?.respondPermissionCalls ?? [];
  }
}

class FakeHandle implements RuntimeRunHandle {
  respondPermissionCalls: RuntimePermissionResponseInput[] = [];

  sendInput(_input: RuntimeInput): void {}
  stop(): void {}
  flush(): RuntimeEventDraft[] { return []; }
  respondPermission(input: RuntimePermissionResponseInput): void {
    this.respondPermissionCalls.push(input);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function setupSupervisor(db: SqliteDatabase) {
  const registry = new RuntimeAdapterRegistry();
  const fakeDriver = new FakeDriver();
  // Replace internal driver map entry with our fake
  const drivers = (registry as unknown as { drivers: Map<string, RuntimeSessionDriver> }).drivers;
  drivers.set("claude:acp", fakeDriver);

  const outboxStore = new OutboxStore(db);
  const supervisor = new RuntimeSupervisor({
    db,
    adapterRegistry: registry,
    processFactory: FakeProcessFactory,
    outboxStore,
  });

  return { supervisor, fakeDriver };
}

function createSessionAndTask(
  sessions: SessionStore,
  events: EventStore,
  channelType: string | null,
) {
  const session = sessions.createSession({
    title: "Test session",
    agentType: "claude",
    workspacePath: "/tmp/test",
    channelType: channelType as never,
    channelRef: channelType ? `${channelType}:test` : null,
  });

  const { task } = sessions.createTask({
    sessionId: session.id,
    sourceType: (channelType ?? "web") as SourceType,
    type: "message",
    input: { text: "hello" },
  });

  return { session, task };
}

const PERMISSION_PROMPT_DRAFT: RuntimeEventDraft = {
  type: "permission_prompt",
  payload: {
    requestId: "req_1",
    text: "Allow tool call?",
    options: [
      { kind: "allow_always", name: "Always Allow", optionId: "allow_always" },
      { kind: "allow_once", name: "Allow", optionId: "allow" },
      { kind: "reject_once", name: "Reject", optionId: "reject" },
    ],
    toolCall: { toolCallId: "tc_1", title: "mcp__zread__get_repo_structure", rawInput: {}, kind: "other", content: [] },
  },
};

// ── Tests ────────────────────────────────────────────────────────────────

describe("RuntimeSupervisor permission auto-approve", () => {
  let db: SqliteDatabase;
  let sessions: SessionStore;
  let events: EventStore;
  let permissions: PermissionRequestStore;

  beforeEach(() => {
    db = createTestDb();
    events = new EventStore(db);
    sessions = new SessionStore(db, events);
    new MessageStore(db);
    permissions = new PermissionRequestStore(db);
    new OutboxStore(db);
  });

  afterEach(() => disposeTestDb(db));

  it("auto-approves permission_prompt from QQ session", () => {
    const { supervisor, fakeDriver } = setupSupervisor(db);
    const { session, task } = createSessionAndTask(sessions, events, "qq");

    supervisor.startTask({ sessionId: session.id, taskId: task.id });

    // Simulate agent emitting a permission_prompt
    fakeDriver.emit(PERMISSION_PROMPT_DRAFT);

    // Permission should be auto-approved in DB
    const reqs = permissions.listByRun(sessions.getRun(sessions.getSession(session.id)!.activeRunId!)!.id);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].status).toBe("approved");

    // Run status should be back to running (not waiting_permission)
    const run = sessions.getRun(sessions.getSession(session.id)!.activeRunId!)!;
    expect(run.status).toBe("running");

    // Handle's respondPermission should have been called
    expect(fakeDriver.respondPermissionCalls).toHaveLength(1);
    expect(fakeDriver.respondPermissionCalls[0].outcome).toBe("selected");
    expect(fakeDriver.respondPermissionCalls[0].optionId).toBe("allow");
  });

  it("does NOT auto-approve permission_prompt from web session", () => {
    const { supervisor, fakeDriver } = setupSupervisor(db);
    const { session, task } = createSessionAndTask(sessions, events, "web");

    supervisor.startTask({ sessionId: session.id, taskId: task.id });

    fakeDriver.emit(PERMISSION_PROMPT_DRAFT);

    const run = sessions.getRun(sessions.getSession(session.id)!.activeRunId!)!;
    expect(run.status).toBe("waiting_permission");

    const reqs = permissions.listByRun(run.id);
    expect(reqs[0].status).toBe("pending");

    expect(fakeDriver.respondPermissionCalls).toHaveLength(0);
  });

  it("auto-approves permission_prompt from telegram session", () => {
    const { supervisor, fakeDriver } = setupSupervisor(db);
    const { session, task } = createSessionAndTask(sessions, events, "telegram");

    supervisor.startTask({ sessionId: session.id, taskId: task.id });
    fakeDriver.emit(PERMISSION_PROMPT_DRAFT);

    const run = sessions.getRun(sessions.getSession(session.id)!.activeRunId!)!;
    expect(run.status).toBe("running");
    expect(fakeDriver.respondPermissionCalls).toHaveLength(1);
  });

  it("falls back gracefully when handle has no respondPermission", () => {
    // Use a driver whose handle lacks respondPermission
    const registry = new RuntimeAdapterRegistry();

    const bareDriver = new (class extends FakeDriver {
      start(_ctx: RuntimeDriverStartContext, _proc: RuntimeProcess, callbacks: RuntimeDriverCallbacks): RuntimeRunHandle {
        // Capture callbacks for emitting
        (this as unknown as { _cb: RuntimeDriverCallbacks })._cb = callbacks;
        // Return handle WITHOUT respondPermission
        return {
          sendInput() {},
          stop() {},
          flush(): RuntimeEventDraft[] { return []; },
          // respondPermission intentionally omitted
        };
      }
      emit(drafts: RuntimeEventDraft | RuntimeEventDraft[]) {
        ((this as unknown as { _cb: RuntimeDriverCallbacks })._cb).emit(drafts);
      }
    })();

    const drivers = (registry as unknown as { drivers: Map<string, RuntimeSessionDriver> }).drivers;
    drivers.set("claude:acp", bareDriver);

    const supervisor = new RuntimeSupervisor({
      db,
      adapterRegistry: registry,
      processFactory: FakeProcessFactory,
    });

    const { session, task } = createSessionAndTask(sessions, events, "qq");
    supervisor.startTask({ sessionId: session.id, taskId: task.id });

    // Should NOT throw — just falls through to waiting_permission
    expect(() => bareDriver.emit(PERMISSION_PROMPT_DRAFT)).not.toThrow();

    const run = sessions.getRun(sessions.getSession(session.id)!.activeRunId!)!;
    expect(run.status).toBe("waiting_permission");
  });

  it("sends scheduled web run output to configured QQ and Telegram notification targets", () => {
    const { supervisor, fakeDriver } = setupSupervisor(db);
    const session = sessions.createSession({
      title: "Scheduled web session",
      agentType: "claude",
      workspacePath: "/tmp/test",
      channelType: "web",
      channelRef: "web-session",
    });
    const { task } = sessions.createTask({
      sessionId: session.id,
      sourceType: "cron",
      type: "schedule_run",
      input: {
        text: "scheduled prompt",
        notificationTargets: [
          { channelType: "qq", targetRef: "group:123" },
          { channelType: "telegram", targetRef: "private:456" },
        ],
      },
    });
    const outbox = new OutboxStore(db);

    supervisor.startTask({ sessionId: session.id, taskId: task.id });
    fakeDriver.emit({
      type: "text_delta",
      payload: { text: "Scheduled result", receivedAt: new Date().toISOString() },
    });
    fakeDriver.exit();

    const items = outbox.claimDue({ workerId: "test", limit: 10 });
    expect(items).toHaveLength(2);
    expect(items.map((item) => [item.channelType, item.targetRef])).toEqual([
      ["qq", "group:123"],
      ["telegram", "private:456"],
    ]);
    expect(items.every((item) => (item.viewModel as { text?: string }).text?.includes("Scheduled result"))).toBe(true);
  });
});
