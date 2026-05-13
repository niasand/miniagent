import { afterEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/server/events/event-store.js";
import { CodexRuntimeAdapter } from "../../src/server/runtime/adapters/codex-adapter.js";
import type { RuntimeProcess, RuntimeProcessExit, RuntimeProcessFactory } from "../../src/server/runtime/process.js";
import { RuntimeAdapterRegistry } from "../../src/server/runtime/registry.js";
import { RuntimeSupervisor } from "../../src/server/runtime/runtime-supervisor.js";
import type { RuntimeLaunchSpec, RuntimeOutputChunk } from "../../src/server/runtime/types.js";
import { SessionStore } from "../../src/server/sessions/session-store.js";
import { createTestDatabase } from "../support/db.js";

describe("RuntimeSupervisor", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("starts a run, sends input, batches stdout, and finishes successfully", () => {
    const fixture = createSupervisorFixture();
    const started = fixture.supervisor.startTask({ sessionId: "session-1", taskId: "task-1" });

    fixture.supervisor.sendInput(started.run.id, { taskType: "message", input: { text: "hello" } });
    fixture.process.emitOutput({ stream: "stdout", text: "hel", receivedAt: "2026-05-13T00:00:00.000Z" });
    fixture.process.emitOutput({ stream: "stdout", text: "lo", receivedAt: "2026-05-13T00:00:00.050Z" });
    fixture.process.emitExit({ exitCode: 0, signal: null, message: null, exitedAt: "2026-05-13T00:00:01.000Z" });

    expect(fixture.process.writes).toEqual(["hello\n"]);
    expect(fixture.factory.spawnedSpec).toMatchObject({
      agentType: "codex",
      command: "codex",
      cwd: "/tmp/miniagent-test",
    });

    const events = fixture.eventStore.listAfterGlobalSeq({ afterGlobalSeq: 0 });
    expect(events.map((event) => event.type)).toEqual(["task_created", "run_started", "text_delta", "run_finished"]);
    expect(events[2].payload).toMatchObject({
      text: "hello",
      firstReceivedAt: "2026-05-13T00:00:00.000Z",
      lastReceivedAt: "2026-05-13T00:00:00.050Z",
    });
    expect(fixture.sessionStore.getRun(started.run.id)).toMatchObject({
      status: "succeeded",
      pid: 4321,
      exitCode: 0,
    });

    const outboxCount = fixture.db.prepare("SELECT COUNT(*) AS count FROM outbox").get() as { count: number };
    expect(outboxCount.count).toBe(0);
  });

  it("flushes buffered stdout before appending stderr events", () => {
    const fixture = createSupervisorFixture();
    const started = fixture.supervisor.startTask({ sessionId: "session-1", taskId: "task-1" });

    fixture.process.emitOutput({ stream: "stdout", text: "partial", receivedAt: "2026-05-13T00:00:00.000Z" });
    fixture.process.emitOutput({ stream: "stderr", text: "warning", receivedAt: "2026-05-13T00:00:00.100Z" });

    const events = fixture.eventStore.listAfterGlobalSeq({ afterGlobalSeq: 0 });
    expect(events.map((event) => event.type)).toEqual(["task_created", "run_started", "text_delta", "runtime_stderr"]);
    expect(events[2].payload).toMatchObject({ text: "partial" });
    expect(events[3].payload).toMatchObject({ text: "warning" });
    expect(() => fixture.supervisor.sendInput(started.run.id, { taskType: "message", input: "still active" })).not.toThrow();
  });

  it("maps context overflow exits to run overflow and session compaction", () => {
    const fixture = createSupervisorFixture();
    const started = fixture.supervisor.startTask({ sessionId: "session-1", taskId: "task-1" });

    fixture.process.emitExit({
      exitCode: 1,
      signal: null,
      message: "context length limit exceeded",
      exitedAt: "2026-05-13T00:00:01.000Z",
    });

    expect(fixture.sessionStore.getRun(started.run.id)).toMatchObject({
      status: "overflowed",
      errorClass: "context_overflow",
    });
    expect(fixture.sessionStore.getSession("session-1")).toMatchObject({
      status: "compacting",
      activeRunId: null,
    });

    const lastEvent = fixture.eventStore.listAfterGlobalSeq({ afterGlobalSeq: 0 }).at(-1);
    expect(lastEvent).toMatchObject({
      type: "run_failed",
      payload: { status: "overflowed", errorClass: "context_overflow" },
    });
  });

  it("stops active processes and maps SIGTERM exits to cancellation", () => {
    const fixture = createSupervisorFixture();
    const started = fixture.supervisor.startTask({ sessionId: "session-1", taskId: "task-1" });

    fixture.supervisor.stop(started.run.id);
    fixture.process.emitExit({
      exitCode: null,
      signal: "SIGTERM",
      message: null,
      exitedAt: "2026-05-13T00:00:01.000Z",
    });

    expect(fixture.process.stoppedSignal).toBe("SIGTERM");
    expect(fixture.sessionStore.getRun(started.run.id)).toMatchObject({
      status: "cancelled",
      errorClass: "user_cancelled",
    });
    expect(() => fixture.supervisor.sendInput(started.run.id, { taskType: "message", input: "after exit" })).toThrow(
      "Runtime run is not active",
    );
  });

  function createSupervisorFixture() {
    const testDb = createTestDatabase();
    cleanup = testDb.close;
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
      input: { text: "hello" },
    });

    const process = new FakeRuntimeProcess();
    const factory = new FakeProcessFactory(process);
    const supervisor = new RuntimeSupervisor({
      adapterRegistry: new RuntimeAdapterRegistry([new CodexRuntimeAdapter()]),
      eventStore,
      sessionStore,
      processFactory: factory,
      maxTextDeltaBytes: 1_000,
    });

    return {
      db: testDb.db,
      eventStore,
      factory,
      process,
      sessionStore,
      supervisor,
    };
  }
});

class FakeProcessFactory implements RuntimeProcessFactory {
  spawnedSpec: RuntimeLaunchSpec | null = null;

  constructor(private readonly process: FakeRuntimeProcess) {}

  spawn(spec: RuntimeLaunchSpec): RuntimeProcess {
    this.spawnedSpec = spec;
    return this.process;
  }
}

class FakeRuntimeProcess implements RuntimeProcess {
  readonly pid = 4321;
  readonly writes: string[] = [];
  stoppedSignal: string | null = null;

  private readonly outputHandlers = new Set<(chunk: RuntimeOutputChunk) => void>();
  private readonly exitHandlers = new Set<(exit: RuntimeProcessExit) => void>();

  write(input: string): void {
    this.writes.push(input);
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

  emitOutput(chunk: RuntimeOutputChunk): void {
    for (const handler of this.outputHandlers) {
      handler(chunk);
    }
  }

  emitExit(exit: RuntimeProcessExit): void {
    for (const handler of this.exitHandlers) {
      handler(exit);
    }
  }
}
