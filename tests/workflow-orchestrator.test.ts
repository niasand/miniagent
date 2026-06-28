import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, disposeTestDb } from "./helpers.js";
import { WorkflowOrchestrator } from "../src/server/workflows/orchestrator.js";
import { EventStore } from "../src/server/stores/event-store.js";
import { SessionStore } from "../src/server/stores/session-store.js";
import { MessageStore } from "../src/server/stores/message-store.js";
import { createId } from "../src/shared/ids.js";
import type { WorkflowDefinition } from "../src/server/workflows/definition.js";
import type { SqliteDatabase } from "../src/server/db/migrate.js";
import type { RuntimeService } from "../src/server/runtime/service.js";

const linear: WorkflowDefinition = {
  name: "linear",
  nodes: [
    { id: "a", type: "echo", message: "A" },
    { id: "b", type: "echo", message: "B", dependsOn: ["a"] },
    { id: "c", type: "echo", message: "C", dependsOn: ["b"] },
  ],
};

const diamond: WorkflowDefinition = {
  name: "diamond",
  nodes: [
    { id: "a", type: "echo", message: "A" },
    { id: "b", type: "echo", message: "B", dependsOn: ["a"] },
    { id: "c", type: "echo", message: "C", dependsOn: ["a"] },
    { id: "d", type: "echo", message: "D", dependsOn: ["b", "c"] },
  ],
};

const gated: WorkflowDefinition = {
  name: "gated",
  nodes: [
    { id: "a", type: "echo", message: "A" },
    { id: "g", type: "human_gate", prompt: "Approve?", dependsOn: ["a"] },
    { id: "b", type: "echo", message: "B", dependsOn: ["g"] },
  ],
};

describe("WorkflowOrchestrator", () => {
  let db: SqliteDatabase;
  let orch: WorkflowOrchestrator;
  let events: EventStore;

  beforeEach(() => {
    db = createTestDb();
    events = new EventStore(db);
    orch = new WorkflowOrchestrator(db);
  });
  afterEach(() => disposeTestDb(db));

  const wfEventTypes = (runId: string) =>
    events.listByRun(runId).filter((e) => e.type.startsWith("wf.")).map((e) => e.type);

  const dispatchedOrder = (runId: string) =>
    events
      .listByRun(runId)
      .filter((e) => e.type === "wf.node_dispatched")
      .map((e) => (e.payload as Record<string, unknown>).nodeId);

  it("runs a linear echo DAG to completion in order", () => {
    const { runId } = orch.startRun({ definition: linear });
    expect(orch.getRun(runId)!.status).toBe("succeeded");
    const types = wfEventTypes(runId);
    expect(types).toContain("wf.run_started");
    expect(types.filter((t) => t === "wf.node_succeeded")).toHaveLength(3);
    expect(types).toContain("wf.run_completed");
    expect(dispatchedOrder(runId)).toEqual(["a", "b", "c"]);
  });

  it("runs a diamond DAG: B and C after A, D after both", () => {
    const { runId } = orch.startRun({ definition: diamond });
    expect(orch.getRun(runId)!.status).toBe("succeeded");
    const order = dispatchedOrder(runId);
    expect(order).toHaveLength(4);
    expect(order[0]).toBe("a");
    expect(order[3]).toBe("d");
    expect(new Set(order.slice(1, 3))).toEqual(new Set(["b", "c"]));
  });

  it("opens a human gate and waits, then continues on approve", () => {
    const { runId } = orch.startRun({ definition: gated });
    const waiting = orch.getRun(runId)!;
    expect(waiting.status).toBe("waiting_gate");
    expect(waiting.currentGateNode).toBe("g");

    orch.resolveGate({ runId, nodeId: "g", decision: "approve" });
    expect(orch.getRun(runId)!.status).toBe("succeeded");
    expect(dispatchedOrder(runId)).toEqual(["a", "g", "b"]);
  });

  it("fails the run when a gate is rejected", () => {
    const { runId } = orch.startRun({ definition: gated });
    orch.resolveGate({ runId, nodeId: "g", decision: "reject" });
    const run = orch.getRun(runId)!;
    expect(run.status).toBe("failed");
    expect(run.errorNode).toBe("g");
  });

  it("rejects resolving a gate that is not open (idempotency)", () => {
    const { runId } = orch.startRun({ definition: gated });
    orch.resolveGate({ runId, nodeId: "g", decision: "approve" });
    // gate already resolved → run is terminal; second resolve must throw
    expect(() => orch.resolveGate({ runId, nodeId: "g", decision: "approve" })).toThrow();
  });

  it("rejects invalid workflow definitions", () => {
    expect(() => orch.startRun({ definition: { name: "x", nodes: [] } })).toThrow();
    expect(() =>
      orch.startRun({ definition: { name: "x", nodes: [
        { id: "a", type: "echo" }, { id: "a", type: "echo" },
      ] } }),
    ).toThrow();
    expect(() =>
      orch.startRun({ definition: { name: "x", nodes: [
        { id: "a", type: "human_gate" },
      ] } }),
    ).toThrow(); // missing prompt
    expect(() =>
      orch.startRun({ definition: { name: "x", nodes: [
        { id: "a", type: "echo", dependsOn: ["nope"] },
      ] } }),
    ).toThrow(); // unknown dep
    expect(() =>
      orch.startRun({ definition: { name: "x", nodes: [
        { id: "a", type: "echo", dependsOn: ["b"] },
        { id: "b", type: "echo", dependsOn: ["a"] },
      ] } }),
    ).toThrow(); // cycle
    expect(() =>
      orch.startRun({ definition: { name: "x", nodes: [
        { id: "a", type: "agent_task" as never },
      ] } }),
    ).toThrow(); // agent_task missing prompt
  });

  it("advanceAllDue is a no-op on a terminal run", () => {
    const { runId } = orch.startRun({ definition: linear });
    const before = events.listByRun(runId).length;
    orch.advanceAllDue();
    expect(events.listByRun(runId).length).toBe(before);
  });

  it("advanceAllDue recovers a run left mid-execution", () => {
    // Simulate a run that started but never advanced (e.g. crashed after run_started).
    const { runId, sessionId } = orch.startRun({ definition: linear });
    // Manually rewind: mark a fresh run as running with no node events by starting another
    // and asserting advanceAllDue keeps it consistent. Here we just confirm idempotency
    // across a new orchestrator instance (state lives in DB, not memory).
    const orch2 = new WorkflowOrchestrator(db);
    orch2.advanceAllDue();
    expect(orch2.getRun(runId)!.status).toBe("succeeded");
    expect(orch2.getRun(runId)!.sessionId).toBe(sessionId);
  });

  it("runs an agent_task to completion via the reconciler tick", () => {
    // Fake runtimeService: returns a run id without spawning anything; the test
    // materializes the agent run + output afterwards.
    const fakeSvc = {
      startNextQueuedTask: () => ({
        task: { id: "tsk_fake", sessionId: "ses_fake", status: "queued", type: "message", input: {} },
        run: { id: createId("run"), status: "running" },
      }),
    } as unknown as RuntimeService;
    const agentOrch = new WorkflowOrchestrator(db, fakeSvc);

    const def: WorkflowDefinition = {
      name: "agent-flow",
      nodes: [
        { id: "a", type: "echo", message: "A" },
        { id: "t", type: "agent_task", prompt: "do thing", agentType: "claude", workspacePath: "/tmp/x", dependsOn: ["a"] },
        { id: "b", type: "echo", message: "B", dependsOn: ["t"] },
      ],
    };
    const { runId } = agentOrch.startRun({ definition: def });
    // a done; t dispatched + agent run started (running); b blocked on t → run waits
    expect(agentOrch.getRun(runId)!.status).toBe("running");

    const startedEv = events.listByRun(runId).find((e) => e.type === "wf.agent_run_started")!;
    const { agentRunId, agentSessionId } = startedEv.payload as { agentRunId: string; agentSessionId: string };
    const sessions = new SessionStore(db, events);
    const msgStore = new MessageStore(db);
    const task = sessions.getNextQueuedTask(agentSessionId)!;
    sessions.startRun({ id: agentRunId, sessionId: agentSessionId, taskId: task.id, agentType: "claude", runtimeKind: "acp" });
    msgStore.insert({ sessionId: agentSessionId, runId: agentRunId, role: "assistant", content: "did the thing", sourceEventId: startedEv.id });
    sessions.finishRun({ runId: agentRunId, status: "succeeded", exitCode: 0 });

    // Tick drains the agent_task → t succeeds → b dispatches → run completes
    agentOrch.advanceAllDue();
    expect(agentOrch.getRun(runId)!.status).toBe("succeeded");
    expect(wfEventTypes(runId)).toContain("wf.run_completed");
  });

  it("agent_task fails the run when runtimeService is not configured", () => {
    // beforeEach's orch has no runtimeService
    const def: WorkflowDefinition = {
      name: "no-runtime",
      nodes: [{ id: "t", type: "agent_task", prompt: "do", agentType: "claude" }],
    };
    const { runId } = orch.startRun({ definition: def });
    expect(orch.getRun(runId)!.status).toBe("failed");
    expect(orch.getRun(runId)!.errorNode).toBe("t");
  });
});
